// Mirror an animated GIF, left to right.
//
// The pane can already do this while drawing — `flipBusy` in the roster — but a
// README cannot. GitHub strips `style` from images, so `transform: scaleX(-1)`
// never survives, and Charizard was shown facing one way in the README and the
// other way in the actual pane.
//
// Unlike recolouring, this cannot be done by patching bytes: mirroring moves
// every pixel, and the pixels are LZW-compressed. So the frames are decoded,
// flipped, matched back to the palette they came from, and re-encoded.
//
// Matched back rather than re-quantised: every colour in a flipped frame was
// already in the original palette, because flipping invents nothing. So the
// palette is copied across untouched and there is no loss.
//
// Usage: npm run flip -- <in.gif> <out.gif>

import { readFileSync, writeFileSync } from 'node:fs'
import { decodeGif } from './gif.mjs'

const [, , inPath, outPath] = process.argv

if (!inPath || !outPath) {
  console.log('\n  npm run flip -- <in.gif> <out.gif>\n')
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
const { width, height, frames } = image

// A palette slot for "nothing here". Reusing an existing one would punch holes
// in the drawing wherever that colour was meant to be opaque.
const lookup = new Map(palette.map(([r, g, b], i) => [`${r},${g},${b}`, i]))
let transparent = palette.length < 256 ? palette.length : paletteSize - 1

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

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // The mirror: read from the far side of the row.
      const from = (y * width + (width - 1 - x)) * 4
      const to = y * width + x

      indices[to] =
        frame.pixels[from + 3] < 128
          ? transparent
          : (lookup.get(`${frame.pixels[from]},${frame.pixels[from + 1]},${frame.pixels[from + 2]}`) ?? transparent)
    }
  }

  const delay = Math.max(2, Math.round((frame.delay || 100) / 10))

  // Graphic control: restore to background between frames, so a full frame
  // never shows through the one before it.
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

console.log(
  `\n  ${frames.length} frames mirrored, ${check.width}x${check.height}, ${check.frames.length} frames read back` +
    `\n  ${source.length} bytes in, ${out.length} bytes out -> ${outPath}\n`,
)
