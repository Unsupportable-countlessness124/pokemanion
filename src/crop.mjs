// Cut one figure out of a GIF that contains several.
//
// Sprite sheets of a whole cast in a row are common, and the pane wants one of
// them. Cropping cannot be done by patching bytes the way `recolour` and `key`
// can: those relabel a palette, while this moves every pixel to a new address,
// and the pixels are LZW-compressed. So the frames are decoded, cut, matched
// back to the palette they came from, and re-encoded — the same shape as
// `flip`, and for the same reason.
//
// Matched back rather than re-quantised: every colour in a cropped frame was
// already in the original palette, because cutting invents nothing. The palette
// is copied across untouched and there is no loss.
//
// `--find=N` does the arithmetic for you. It looks for columns containing ink,
// groups them into runs, and takes the Nth — which is how "Ash is the middle
// one of five" becomes a crop without anyone measuring pixels by hand.
//
// Usage: npm run crop -- <in.gif> <out.gif> <x> <y> <w> <h>
//        npm run crop -- <in.gif> <out.gif> --find=3

import { readFileSync, writeFileSync } from 'node:fs'
import { decodeGif } from './gif.mjs'

const [, , inPath, outPath, ...rest] = process.argv

if (!inPath || !outPath) {
  console.log('\n  npm run crop -- <in.gif> <out.gif> <x> <y> <w> <h>\n  npm run crop -- <in.gif> <out.gif> --find=<n>\n')
  process.exit(1)
}

const source = readFileSync(inPath)

if ((source[10] & 0x80) === 0) {
  console.log('\n  no global colour table — nothing to map the pixels back to\n')
  process.exit(1)
}

const paletteSize = 2 ** ((source[10] & 0x07) + 1)
const palette = []

for (let i = 0; i < paletteSize; i++) {
  palette.push([source[13 + i * 3], source[14 + i * 3], source[15 + i * 3]])
}

const image = decodeGif(source)
const { width: srcWidth, height: srcHeight, frames } = image

// A pixel counts as background if it is near-white or fully transparent. Both
// appear: a sheet on a white card, and one already keyed out.
const isBackground = (pixels, at) =>
  pixels[at + 3] < 128 || (pixels[at] > 235 && pixels[at + 1] > 235 && pixels[at + 2] > 235)

const findNth = (n) => {
  const inked = new Array(srcWidth).fill(false)

  for (const frame of frames) {
    for (let x = 0; x < srcWidth; x++) {
      if (inked[x]) continue

      for (let y = 0; y < srcHeight; y++) {
        if (!isBackground(frame.pixels, (y * srcWidth + x) * 4)) {
          inked[x] = true
          break
        }
      }
    }
  }

  const runs = []
  let start = null

  for (let x = 0; x <= srcWidth; x++) {
    if (inked[x] && start === null) start = x
    else if (!inked[x] && start !== null) {
      runs.push([start, x - 1])
      start = null
    }
  }

  if (n < 1 || n > runs.length) {
    console.log(`\n  --find=${n} but there are ${runs.length} figures in this GIF\n`)
    process.exit(1)
  }

  const [left, right] = runs[n - 1]
  let top = srcHeight
  let bottom = -1

  for (const frame of frames) {
    for (let y = 0; y < srcHeight; y++) {
      for (let x = left; x <= right; x++) {
        if (isBackground(frame.pixels, (y * srcWidth + x) * 4)) continue

        if (y < top) top = y
        if (y > bottom) bottom = y
        break
      }
    }
  }

  console.log(`\n  ${runs.length} figures found; taking number ${n}`)

  return [left, top, right - left + 1, bottom - top + 1]
}

const asked = rest.find((arg) => arg.startsWith('--find='))
const [x, y, width, height] = asked ? findNth(Number(asked.slice('--find='.length))) : rest.slice(0, 4).map(Number)

if (![x, y, width, height].every((n) => Number.isFinite(n) && n >= 0) || x + width > srcWidth || y + height > srcHeight) {
  console.log(`\n  crop ${x},${y} ${width}x${height} does not fit inside ${srcWidth}x${srcHeight}\n`)
  process.exit(1)
}

// A palette slot for "nothing here", so the area outside the figure — and any
// transparency it already had — survives the round trip.
const lookup = new Map(palette.map(([r, g, b], i) => [`${r},${g},${b}`, i]))
const transparent = palette.length < 256 ? palette.length : paletteSize - 1

if (palette.length < 256) palette.push([0, 0, 0])

const bits = Math.max(2, Math.ceil(Math.log2(palette.length)))
const size = 2 ** bits

while (palette.length < size) palette.push([0, 0, 0])

// GIF's LZW: codes start one bit wider than the palette and grow as the
// dictionary fills, with a clear code resetting it at 4096.
const encode = (indices) => {
  const clear = 1 << bits
  const end = clear + 1
  const out = []
  let current = 0
  let bitsUsed = 0
  let codeWidth = bits + 1
  let next = end + 1
  let dict = new Map()

  const emit = (code) => {
    current |= code << bitsUsed
    bitsUsed += codeWidth

    while (bitsUsed >= 8) {
      out.push(current & 0xff)
      current >>= 8
      bitsUsed -= 8
    }
  }

  emit(clear)

  let prefix = indices[0]

  for (let i = 1; i < indices.length; i++) {
    const k = indices[i]
    const key = prefix * 4096 + k

    if (dict.has(key)) {
      prefix = dict.get(key)
      continue
    }

    emit(prefix)
    dict.set(key, next++)

    if (next > 4095) {
      emit(clear)
      dict = new Map()
      next = end + 1
      codeWidth = bits + 1
    } else if (next > 1 << codeWidth) {
      codeWidth++
    }

    prefix = k
  }

  emit(prefix)
  emit(end)

  if (bitsUsed > 0) out.push(current & 0xff)

  return out
}

const bytes = []
const push = (...v) => bytes.push(...v)
const short = (v) => push(v & 0xff, (v >> 8) & 0xff)

push(...[...'GIF89a'].map((c) => c.charCodeAt(0)))
short(width)
short(height)
push(0x80 | ((bits - 1) & 7), 0, 0)

for (const [r, g, b] of palette) push(r, g, b)

// Loop forever, the way the original did.
push(0x21, 0xff, 0x0b, ...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)), 0x03, 0x01, 0x00, 0x00, 0x00)

for (const frame of frames) {
  const indices = new Uint8Array(width * height)

  for (let row = 0; row < height; row++) {
    for (let column = 0; column < width; column++) {
      const from = ((y + row) * srcWidth + (x + column)) * 4

      indices[row * width + column] = isBackground(frame.pixels, from)
        ? transparent
        : (lookup.get(`${frame.pixels[from]},${frame.pixels[from + 1]},${frame.pixels[from + 2]}`) ?? transparent)
    }
  }

  const delay = Math.max(2, Math.round((frame.delay || 100) / 10))

  // Restore to background between frames, so a full frame never shows through
  // the one before it.
  push(0x21, 0xf9, 0x04, 0x08 | 0x01)
  short(delay)
  push(transparent, 0x00)

  push(0x2c)
  short(0)
  short(0)
  short(width)
  short(height)
  push(0x00)
  push(bits)

  const data = encode(indices)

  for (let i = 0; i < data.length; i += 255) {
    const chunk = data.slice(i, i + 255)

    push(chunk.length, ...chunk)
  }

  push(0x00)
}

push(0x3b)

const out = Buffer.from(bytes)

writeFileSync(outPath, out)

// Decoding it back is the only proof that matters.
const check = decodeGif(out)
let clear = 0

for (let i = 3; i < check.frames[0].pixels.length; i += 4) if (check.frames[0].pixels[i] < 128) clear++

console.log(
  `  cut ${x},${y} ${width}x${height} out of ${srcWidth}x${srcHeight}` +
    `\n  ${check.frames.length} frames read back, ${((100 * clear) / (width * height)).toFixed(0)}% transparent` +
    `\n  ${source.length} bytes in, ${out.length} bytes out -> ${outPath}\n`,
)
