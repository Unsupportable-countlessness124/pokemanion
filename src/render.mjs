// Turns decoded RGBA frames into terminal art.
//
// Each character cell holds two pixels: the upper half block glyph paints the
// top pixel in the foreground colour and the bottom pixel in the background
// colour, so a cell is twice as tall as it is wide and sprites keep roughly
// their real proportions.

import { CELL_SHAPES, toCellRows } from './cells.mjs'

const UPPER = '▀'
const LOWER = '▄'
const RESET = '\x1b[0m'
const DEFAULT_BG = '\x1b[49m'

const ALPHA_FLOOR = 128

const at = (pixels, width, x, y) => (y * width + x) * 4

const isOpaque = (pixels, width, x, y) => pixels[at(pixels, width, x, y) + 3] >= ALPHA_FLOOR

// One bounding box for the whole animation. Trimming each frame on its own
// would re-centre the sprite every frame and make it twitch in place.
export const sharedBounds = (frames, width, height) => {
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1

  for (const { pixels } of frames) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!isOpaque(pixels, width, x, y)) continue

        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }

  if (maxX < 0) return { x: 0, y: 0, width, height }

  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

const luminance = (r, g, b) => r * 0.3 + g * 0.6 + b * 0.1

// A sprite carries more shades than survive being shrunk. Pikachu's body is one
// yellow plus two shading yellows; reduced threefold, neighbouring blocks land
// on different shades and a flat belly breaks up into speckle. Collapsing the
// palette to the few colours that actually carry the design puts the flat areas
// back, and because the sprite is drawn in flat colour to begin with, nothing is
// lost by doing it.
//
// The palette is counted across every frame, so a colour never flickers between
// two shades from one frame to the next.
export const buildPalette = (frames, width, height, size, chroma = 0) => {
  const counts = new Map()

  for (const { pixels } of frames) {
    for (let i = 0; i < width * height * 4; i += 4) {
      if (pixels[i + 3] < ALPHA_FLOOR) continue

      const key = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]

      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }

  // Ranking purely by how much of the sprite a colour covers is what loses the
  // cheek. Pikachu's red is 1.4% of him and sits tenth, while two nearly black
  // greys from the sprite's own anti-aliasing get in on area alone and are
  // indistinguishable from the outline once drawn.
  //
  // Weighting by how colourful a colour is fixes the ordering: a small vivid
  // mark outranks a large dull one, greys fall away, and the palette ends up
  // holding the colours a person would actually name.
  const score = ([r, g, b], count) => {
    const high = Math.max(r, g, b)
    const saturation = high === 0 ? 0 : (high - Math.min(r, g, b)) / high

    return count * (1 + chroma * saturation)
  }

  return [...counts.entries()]
    .map(([key, count]) => ({
      colour: [(key >> 16) & 255, (key >> 8) & 255, key & 255],
      count,
    }))
    .sort((a, b) => score(b.colour, b.count) - score(a.colour, a.count))
    .slice(0, size)
    .map(({ colour }) => colour)
}

const nearest = (palette, r, g, b) => {
  let best = palette[0]
  let bestDistance = Infinity

  for (const colour of palette) {
    const dr = colour[0] - r
    const dg = colour[1] - g
    const db = colour[2] - b
    const distance = dr * dr + dg * dg + db * db

    if (distance < bestDistance) {
      bestDistance = distance
      best = colour
    }
  }

  return best
}

export const quantize = (pixels, palette) => {
  const out = new Uint8Array(pixels.length)

  out.set(pixels)

  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] < ALPHA_FLOOR) continue

    const colour = nearest(palette, out[i], out[i + 1], out[i + 2])

    out[i] = colour[0]
    out[i + 1] = colour[1]
    out[i + 2] = colour[2]
  }

  return out
}

const OUTLINE_LUMINANCE = 80
const OUTLINE_SHARE = 0.28

// Picking a colour for one output pixel out of the source block behind it.
//
// Averaging is what you would reach for and it is wrong here: a sprite's one
// pixel wide black outline is a minority of every block it falls in, so the
// mean slides towards the body colour and the whole thing turns to mush. All
// three samplers below return a colour that actually exists in the source.
const SAMPLERS = {
  // Most frequent colour. Keeps flat regions flat and holds outlines wherever
  // they are thick enough to win their block. The default.
  mode: (block) => {
    const counts = new Map()

    for (const colour of block) {
      const key = (colour[0] << 16) | (colour[1] << 8) | colour[2]

      counts.set(key, (counts.get(key) ?? 0) + 1)
    }

    let best = 0
    let bestCount = -1

    for (const [key, count] of counts) {
      if (count > bestCount) {
        best = key
        bestCount = count
      }
    }

    return [(best >> 16) & 255, (best >> 8) & 255, best & 255]
  },

  // The source pixel nearest the block centre. Crispest, but the outline
  // survives or vanishes depending on where the grid happens to land.
  nearest: (block) => block[Math.floor(block.length / 2)],

  // Mode, except a block with a decent share of dark pixels resolves to the
  // darkest of them. Thickens outlines; useful at very small sizes.
  outline: (block) => {
    const dark = block.filter((colour) => luminance(...colour) < OUTLINE_LUMINANCE)

    if (dark.length / block.length >= OUTLINE_SHARE) {
      return dark.reduce((a, b) => (luminance(...a) <= luminance(...b) ? a : b))
    }

    return SAMPLERS.mode(block)
  },
}

// Down to the target size, one source block per output pixel. A block that is
// more than half transparent stays transparent, which keeps the silhouette from
// growing a fringe.
export const resample = (pixels, width, height, bounds, targetWidth, targetHeight, sampler = 'mode') => {
  const out = new Uint8Array(targetWidth * targetHeight * 4)
  const pick = SAMPLERS[sampler] ?? SAMPLERS.mode

  // Work the block out in the crop's own coordinates first, then shift it onto
  // the image. Adding the offset before taking the max folds it in twice and
  // shears every row — invisible whenever the sprite happens to start at 0,0.
  for (let y = 0; y < targetHeight; y++) {
    const localY0 = Math.floor((y * bounds.height) / targetHeight)
    const y0 = bounds.y + localY0
    const y1 = bounds.y + Math.max(localY0 + 1, Math.floor(((y + 1) * bounds.height) / targetHeight))

    for (let x = 0; x < targetWidth; x++) {
      const localX0 = Math.floor((x * bounds.width) / targetWidth)
      const x0 = bounds.x + localX0
      const x1 = bounds.x + Math.max(localX0 + 1, Math.floor(((x + 1) * bounds.width) / targetWidth))

      const block = []
      let total = 0

      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          total++

          // The crop is padded out to reach a whole-number scale, so it can
          // reach past the edge of the image. Outside is transparent.
          if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue

          const from = at(pixels, width, sx, sy)

          if (pixels[from + 3] < ALPHA_FLOOR) continue

          block.push([pixels[from], pixels[from + 1], pixels[from + 2]])
        }
      }

      if (block.length === 0 || block.length * 2 < total) continue

      const colour = pick(block)
      const to = (y * targetWidth + x) * 4

      out[to] = colour[0]
      out[to + 1] = colour[1]
      out[to + 2] = colour[2]
      out[to + 3] = 255
    }
  }

  return out
}

const fg = (pixels, index) =>
  `\x1b[38;2;${pixels[index]};${pixels[index + 1]};${pixels[index + 2]}m`

const bg = (pixels, index) =>
  `\x1b[48;2;${pixels[index]};${pixels[index + 1]};${pixels[index + 2]}m`

// Rows of text, one per pair of pixel rows. Transparency falls back to the
// terminal's own background so the sprite sits on whatever theme is in use.
export const toRows = (pixels, width, height) => {
  const rows = []

  for (let y = 0; y < height; y += 2) {
    let line = ''

    for (let x = 0; x < width; x++) {
      const top = (y * width + x) * 4
      const bottom = ((y + 1) * width + x) * 4
      const hasTop = pixels[top + 3] >= ALPHA_FLOOR
      const hasBottom = y + 1 < height && pixels[bottom + 3] >= ALPHA_FLOOR

      if (!hasTop && !hasBottom) {
        line += `${RESET} `
        continue
      }

      // Both halves the same colour: paint the cell's background and draw no
      // glyph at all. A glyph only covers the font's own box, so a terminal
      // that adds line spacing leaves a gap under every row and slices the
      // sprite into strips. A background colour fills the whole cell. Most of
      // a sprite's interior is one flat colour, so this removes most of the
      // seams without costing any detail.
      if (hasTop && hasBottom) {
        const same =
          pixels[top] === pixels[bottom] &&
          pixels[top + 1] === pixels[bottom + 1] &&
          pixels[top + 2] === pixels[bottom + 2]

        line += same
          ? `${bg(pixels, top)} `
          : `${fg(pixels, top)}${bg(pixels, bottom)}${UPPER}`
        continue
      }

      if (hasTop) {
        line += `${DEFAULT_BG}${fg(pixels, top)}${UPPER}`
        continue
      }

      line += `${DEFAULT_BG}${fg(pixels, bottom)}${LOWER}`
    }

    rows.push(`${line}${RESET}`)
  }

  return rows
}

// One pixel per cell, painted as background colour behind two spaces rather
// than as a glyph.
//
// Half blocks pack twice the vertical detail into the same number of rows, but
// they are glyphs, and a terminal that adds line spacing draws them with a gap
// underneath — the sprite comes out visibly striped. A background colour fills
// the whole cell whatever the line spacing is. Two spaces per pixel because a
// cell is about twice as tall as it is wide, and we want square pixels.
export const toBlockRows = (pixels, width, height) => {
  const rows = []

  for (let y = 0; y < height; y++) {
    let line = ''

    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4

      if (pixels[index + 3] < ALPHA_FLOOR) {
        line += `${RESET}  `
        continue
      }

      line += `${bg(pixels, index)}  `
    }

    rows.push(`${line}${RESET}`)
  }

  return rows
}

// Every source pixel should land in a block the same size as its neighbours.
// At a fractional reduction — 60px into 16px is 3.75 — some blocks are 3 pixels
// across and some are 4, so edges that are straight in the sprite come out
// ragged. This is the single biggest thing you can do for legibility.
//
// Rather than restrict which row counts are allowed, grow the crop until it is
// an exact multiple of the size we want. A 46px sprite into 8 rows needs 48, so
// the crop takes a pixel of empty space above and below and divides by exactly
// three. Padding can run past the edge of the image; resample treats outside as
// transparent.
export const fitBounds = (bounds, rows, pixelsPerCell, aspect, squareness = 1) => {
  const pixelHeight = rows * pixelsPerCell

  // Round the reduction up, never down. Rounding to nearest can land on a crop
  // smaller than the sprite, which silently slices its edges off — the bounding
  // box is already tight, so there is no spare margin to give away.
  const factor = Math.max(1, Math.ceil(bounds.height / pixelHeight))

  const pixelWidth = Math.max(1, Math.round(pixelHeight * aspect * squareness))

  // The crop keeps the sprite's own proportions, so it is the height's padding
  // that decides the width. Scaling the width by the reduction factor instead
  // double-counts it — a cell holding two pixels across already has the wider
  // grid baked into pixelWidth — and the sprite ends up adrift in a box twice
  // as wide as it needs, which reads as stretched and thin.
  const neededHeight = pixelHeight * factor
  const neededWidth = Math.max(bounds.width, Math.round(neededHeight * aspect))

  return {
    factor,
    pixelWidth,
    pixelHeight,
    bounds: {
      x: bounds.x - Math.floor((neededWidth - bounds.width) / 2),
      y: bounds.y - Math.floor((neededHeight - bounds.height) / 2),
      width: neededWidth,
      height: neededHeight,
    },
  }
}

// A frame is the list of text rows it occupies, ready to print.
//
// Width is derived from the sprite's own proportions rather than being given.
// A half block cell is two pixels tall and one wide, and terminal cells are
// about twice as tall as they are wide, so a sprite pixel comes out square and
// the source aspect ratio carries straight through. Fixing both dimensions by
// hand is how you end up with a Pikachu squashed sideways.
export const renderFrames = (
  { frames, width, height },
  { rows, cols, sampler, snap = true, style = 'half', palette: paletteSize = 0, paletteChroma = 0, cellAspect = 2 } = {},
) => {
  const bounds = sharedBounds(frames, width, height)

  // How many pixels one cell holds, and how wide that makes a pixel. 'blocks'
  // paints a whole cell per pixel; everything else subdivides it.
  const shape = CELL_SHAPES[style] ?? { width: 1, height: 1 }
  const pixelsPerCell = style === 'blocks' ? 1 : shape.height
  const cellPixelWidth = style === 'blocks' ? 1 : shape.width

  // A cell is about twice as tall as it is wide, so a pixel comes out square
  // when the cell is cut into twice as many rows as columns. 'blocks' is the
  // exception: it spends two whole cells per pixel to get the same result, so
  // its pixels are already square.
  const squareness = style === 'blocks' ? 1 : (cellAspect * cellPixelWidth) / pixelsPerCell

  const aspect = bounds.width / bounds.height

  const fitted = snap
    ? fitBounds(bounds, rows, pixelsPerCell, aspect, squareness)
    : {
        factor: null,
        bounds,
        pixelHeight: rows * pixelsPerCell,
        pixelWidth: Math.max(1, Math.round(rows * pixelsPerCell * aspect * squareness)),
      }

  const targetHeight = fitted.pixelHeight
  const targetWidth = cols ? cols * cellPixelWidth : fitted.pixelWidth

  // Flattening the palette is there to stop neighbouring blocks landing on
  // different shades when the sprite is shrunk. At 1:1 no block covers more
  // than one pixel, so there is no speckle to prevent and quantising would only
  // throw colour away. Leave the sprite exactly as drawn.
  const flatten = paletteSize > 0 && fitted.factor !== 1
  const palette = flatten ? buildPalette(frames, width, height, paletteSize, paletteChroma) : null
  const source = palette
    ? frames.map((frame) => ({ ...frame, pixels: quantize(frame.pixels, palette) }))
    : frames

  const draw =
    style === 'blocks'
      ? toBlockRows
      : style === 'half'
        ? toRows
        : (px, w, h) => toCellRows(px, w, h, style)

  return {
    rows,
    cols: style === 'blocks' ? targetWidth * 2 : Math.ceil(targetWidth / cellPixelWidth),
    factor: fitted.factor,
    palette: palette?.length ?? null,
    frames: source.map(({ pixels, delay }) => ({
      delay,
      rows: draw(
        resample(pixels, width, height, fitted.bounds, targetWidth, targetHeight, sampler),
        targetWidth,
        targetHeight,
      ),
    })),
  }
}
