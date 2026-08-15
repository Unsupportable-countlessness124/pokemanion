// Make a GIF's background transparent, without re-encoding it.
//
// Fan art arrives on a flat white background more often than not, and the pane
// needs transparency — a sprite drawn on white renders as a rectangle sitting
// in the middle of your terminal rather than as a Pokemon. Every sprite that
// ships here is 67-78% transparent; a downloaded one is frequently 0%.
//
// Nothing needs re-encoding to fix that. A GIF's pixels are indices into a
// colour table, and transparency is a per-frame flag in the Graphic Control
// Extension naming one of those indices as "draw nothing here". So making the
// background transparent is: find which index the background colour is, then
// set that flag on each frame. The pixel data is untouched.
//
// That is the same insight recolour.mjs uses to repaint a sprite by patching
// three bytes, and the reason both of those are byte patches while flip.mjs
// needs a full LZW re-encoder: moving pixels is real work, relabelling them is
// not.
//
// The colour defaults to the top-left pixel, which is the background in every
// case worth automating. Pass --colour=r,g,b to say otherwise.
//
// Usage: npm run key -- <in.gif> <out.gif> [--colour=255,255,255]

import { readFileSync, writeFileSync } from 'node:fs'
import { decodeGif } from './gif.mjs'

const [, , inPath, outPath] = process.argv

if (!inPath || !outPath) {
  console.log('\n  npm run key -- <in.gif> <out.gif> [--colour=255,255,255]\n')
  process.exit(1)
}

const source = readFileSync(inPath)

if ((source[10] & 0x80) === 0) {
  console.log('\n  no global colour table — nothing to mark transparent\n')
  process.exit(1)
}

const paletteSize = 2 ** ((source[10] & 0x07) + 1)
const palette = []

for (let i = 0; i < paletteSize; i++) {
  palette.push([source[13 + i * 3], source[14 + i * 3], source[15 + i * 3]])
}

const before = decodeGif(source)
const asked = process.argv.find((arg) => arg.startsWith('--colour='))
const wanted = asked
  ? asked.slice('--colour='.length).split(',').map(Number)
  : [before.frames[0].pixels[0], before.frames[0].pixels[1], before.frames[0].pixels[2]]

const index = palette.findIndex(([r, g, b]) => r === wanted[0] && g === wanted[1] && b === wanted[2])

if (index === -1) {
  console.log(`\n  ${wanted.join(',')} is not in the palette — this GIF does not use it as a flat colour\n`)
  process.exit(1)
}

// Walk the file, and at every Graphic Control Extension set the transparency
// flag and name our index. The block is fixed-width — 21 F9 04, flags, two
// delay bytes, the transparent index, then a terminator — so this is four
// bytes of arithmetic rather than a parser.
const out = Buffer.from(source)
let patched = 0

for (let i = 0; i < out.length - 8; i++) {
  if (out[i] !== 0x21 || out[i + 1] !== 0xf9 || out[i + 2] !== 0x04) continue

  // Bit 0 of the flags byte is "a transparent index follows". The disposal
  // method lives in bits 2-4 and is left exactly as it was: changing it is how
  // you get frames smearing into each other.
  out[i + 3] |= 0x01
  out[i + 6] = index
  patched++
}

if (patched === 0) {
  console.log('\n  no graphic control blocks — nothing to patch\n')
  process.exit(1)
}

writeFileSync(outPath, out)

// Decoding it back is the only proof that matters, and the number worth
// printing is how much of the frame actually became transparent — if the
// artwork itself used the same colour, this is where the holes show up.
const after = decodeGif(out)
const clear = (image) => {
  const frame = image.frames[0]
  let n = 0

  for (let i = 3; i < frame.pixels.length; i += 4) if (frame.pixels[i] < 128) n++

  return (100 * n) / (image.width * image.height)
}

console.log(
  `\n  ${wanted.join(',')} is palette index ${index}, marked transparent in ${patched} frames` +
    `\n  ${clear(before).toFixed(1)}% -> ${clear(after).toFixed(1)}% transparent` +
    `\n  ${after.frames.length} frames read back, ${after.width}x${after.height} -> ${outPath}\n`,
)
