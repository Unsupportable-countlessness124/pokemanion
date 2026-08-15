// Getting a sprite file into the state the renderer expects.
//
// Three things stand between a downloaded sprite and clean pixel art: it may be
// blown up from its real size, it may use a painted-in background instead of an
// alpha channel, and it may be a single still frame with no animation at all.

import { resample } from './render.mjs'

// A sprite found online is often not at its own resolution: someone has blown
// a 40x40 drawing up to 500px so it is visible on a web page. Reducing straight
// from that is worse than reducing from the original, because the sampling grid
// no longer lines up with the artwork's real pixels and every block straddles
// two of them.
//
// The original size is recoverable. In an upscaled image each source pixel
// becomes a run of identical pixels, so the commonest run length is the scale
// factor. Divide it out and the artwork comes back exactly as drawn.
const recoverNative = (image) => {
  const { width, height, frames } = image
  const [{ pixels }] = frames

  const key = (x, y) => {
    const i = (y * width + x) * 4

    return pixels[i + 3] < 128 ? -1 : (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]
  }

  const runs = new Map()

  for (let y = 0; y < height; y += 3) {
    let start = 0

    for (let x = 1; x <= width; x++) {
      if (x === width || key(x, y) !== key(x - 1, y)) {
        const length = x - start

        runs.set(length, (runs.get(length) ?? 0) + 1)
        start = x
      }
    }
  }

  // The commonest run alone is not accurate enough: a 12.5x upscale lays down
  // runs of 12 and 13 in roughly equal numbers, and picking either integer
  // misjudges the size by a couple of pixels. Averaging the whole cluster of
  // single-pixel runs recovers the fractional scale.
  const ranked = [...runs.entries()].sort((a, b) => b[1] - a[1])
  const [modal] = ranked[0] ?? [1]

  const cluster = ranked.filter(([length]) => length >= modal * 0.7 && length <= modal * 1.4)
  const weight = cluster.reduce((total, [, count]) => total + count, 0)
  const unit = cluster.reduce((total, [length, count]) => total + length * count, 0) / weight

  if (!(unit >= 2)) return image

  const nativeWidth = Math.max(1, Math.round(width / unit))
  const nativeHeight = Math.max(1, Math.round(height / unit))
  const box = { x: 0, y: 0, width, height }

  return {
    width: nativeWidth,
    height: nativeHeight,
    native: { unit, from: `${width}x${height}` },
    frames: frames.map((frame) => ({
      ...frame,
      pixels: resample(frame.pixels, width, height, box, nativeWidth, nativeHeight, 'mode'),
    })),
  }
}

// Sprites from the cartridge era predate alpha channels: the background is a
// flat colour, usually white, painted right into the image. Left alone the
// whole rectangle counts as opaque and the sprite renders as a solid slab.
//
// If every pixel is opaque and all four corners agree on a colour, that colour
// is the background, so knock it out.
const keyOutBackground = (image) => {
  const { width, height, frames } = image
  const [{ pixels }] = frames

  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] < 128) return image
  }

  const cornerAt = (x, y) => {
    const i = (y * width + x) * 4

    return (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]
  }

  const key = cornerAt(0, 0)
  const corners = [cornerAt(width - 1, 0), cornerAt(0, height - 1), cornerAt(width - 1, height - 1)]

  if (!corners.every((corner) => corner === key)) return image

  return {
    ...image,
    frames: frames.map((frame) => {
      const out = new Uint8Array(frame.pixels)

      for (let i = 0; i < out.length; i += 4) {
        const colour = (out[i] << 16) | (out[i + 1] << 8) | out[i + 2]

        if (colour === key) out[i + 3] = 0
      }

      return { ...frame, pixels: out }
    }),
  }
}

// Shift the whole image down by dy, dropping whatever falls off the edge.
const translate = (pixels, width, height, dy) => {
  const out = new Uint8Array(pixels.length)

  for (let y = 0; y < height; y++) {
    const from = y - dy

    if (from < 0 || from >= height) continue

    out.set(pixels.subarray(from * width * 4, (from + 1) * width * 4), y * width * 4)
  }

  return out
}

// A still sprite gets an animation of its own: a small hop on a four step
// cycle, which is how sprites this size have always been made to look alive.
// The shared bounding box grows by the height of the hop, so the sprite moves
// inside its box instead of the box following it around.
const BOUNCE_CYCLE = [0, -1, -2, -1]

const bounce = (image, amplitude) => {
  if (image.frames.length > 1 || !amplitude) return image

  const [{ pixels, delay }] = image.frames

  return {
    ...image,
    frames: BOUNCE_CYCLE.map((step) => ({
      delay,
      pixels: translate(pixels, image.width, image.height, step * amplitude),
    })),
  }
}


// A tall, narrow image is usually not one picture but a strip of frames — the
// small sprites that were drawn for old games are distributed as sheets, since
// each pose is only a few hundred pixels. If the height is a whole multiple of
// the width, treat it as square frames stacked top to bottom.
export const sliceSheet = (image, pick) => {
  const { width, height, frames } = image

  if (frames.length > 1) return image

  // Frames are laid out along whichever axis is a whole multiple of the other.
  const vertical = height > width && height % width === 0
  const horizontal = width > height && width % height === 0

  if (!vertical && !horizontal) return image

  const size = vertical ? width : height
  const count = vertical ? height / width : width / height
  const [{ pixels, delay }] = frames

  const sliced = Array.from({ length: count }, (unused, index) => {
    const out = new Uint8Array(size * size * 4)

    for (let y = 0; y < size; y++) {
      const sourceX = vertical ? 0 : index * size
      const sourceY = vertical ? index * size + y : y
      const from = (sourceY * width + sourceX) * 4

      out.set(pixels.subarray(from, from + size * 4), y * size * 4)
    }

    return { delay, pixels: out }
  })

  // A sheet usually holds several directions, and only one pair of them is the
  // walk cycle you want — the two halves of a stride are rarely next to each
  // other, so this takes a list of frame numbers rather than a range.
  const chosen = Array.isArray(pick) ? pick.map((index) => sliced[index]).filter(Boolean) : sliced

  return {
    width: size,
    height: size,
    sheet: { count, layout: vertical ? 'vertical' : 'horizontal' },
    frames: chosen.length ? chosen : sliced,
  }
}

// Everything, in the order that matters: recover the real resolution first, so
// the background test and the hop both work on true pixels.
export const prepare = (image, bounceAmplitude = 0, sheetRange = null) =>
  bounce(keyOutBackground(recoverNative(sliceSheet(image, sheetRange))), bounceAmplitude)
