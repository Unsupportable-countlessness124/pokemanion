// Repaint a GIF's palette to match another sprite's, without re-encoding it.
//
// Two animations of the same Pokemon from different artists rarely agree on
// colour, and side by side in the pane that reads as two different creatures.
// Gengar's attack was a duller, bluer purple than its resting sprite.
//
// A GIF stores pixels as indices into a colour table, so the colours can be
// changed without touching a single pixel: patch the table's RGB triples and
// every frame is repainted at once. No decoding, no LZW, no re-encoding, and
// nothing that could degrade the image — the bytes that describe the drawing
// are untouched.
//
// It only works when one global table governs every frame. A GIF with per-frame
// local tables would need each one patched, and this refuses rather than
// half-doing it.
//
// Usage: npm run recolour -- <source.gif> <match-this.gif> <out.gif>

import { readFileSync, writeFileSync } from 'node:fs'
import { decodeGif } from './gif.mjs'

const [, , sourcePath, matchPath, outPath] = process.argv

if (!sourcePath || !matchPath || !outPath) {
  console.log('\n  npm run recolour -- <source.gif> <match-this.gif> <out.gif>\n')
  process.exit(1)
}

const hex = ([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`

// The colours a sprite is actually made of, commonest first. Ranking by use is
// what lets the two be matched by role — body to body, shadow to shadow —
// rather than by whichever happens to be nearest in RGB.
const rankedColours = (path, region = 1) => {
  const image = decodeGif(readFileSync(path))
  const frame = image.frames[0]
  const counts = new Map()

  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < Math.floor(image.width * region); x++) {
      const at = (y * image.width + x) * 4

      if (frame.pixels[at + 3] < 128) continue

      const key = `${frame.pixels[at]},${frame.pixels[at + 1]},${frame.pixels[at + 2]}`

      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }

  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ rgb: key.split(',').map(Number), count }))
}

// Purple, orange, whatever the Pokemon is made of — the body colours, as
// opposed to its outline, eyes and teeth. Taken as the ones that are neither
// near-black nor near-white and are not strongly red.
const isBody = ([r, g, b]) => {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)

  return max > 45 && max < 235 && max - min > 20
}

const buffer = readFileSync(sourcePath)

if ((buffer[10] & 0x80) === 0) {
  console.log('\n  no global colour table in that GIF\n')
  process.exit(1)
}

const tableSize = 2 ** ((buffer[10] & 0x07) + 1)
const TABLE_AT = 13

// Refuse if any frame carries its own table; patching the global one would
// repaint some frames and not others, which is worse than doing nothing.
{
  let at = TABLE_AT + tableSize * 3
  let locals = 0

  while (at < buffer.length && buffer[at] !== 0x3b) {
    if (buffer[at] === 0x21) {
      at += 2
      while (buffer[at]) at += buffer[at] + 1
      at++
      continue
    }

    if (buffer[at] !== 0x2c) break

    const packed = buffer[at + 9]

    if (packed & 0x80) locals++

    at += 10 + (packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0) + 1

    while (buffer[at]) at += buffer[at] + 1

    at++
  }

  if (locals) {
    console.log(`\n  ${locals} frames carry their own colour table — not safe to patch globally\n`)
    process.exit(1)
  }
}

// Only the left of the frame: an attack animation has the target and its effect
// in the rest of it, and those colours are not the Pokemon's.
const source = rankedColours(sourcePath, 0.45).filter((c) => isBody(c.rgb))
const target = rankedColours(matchPath).filter((c) => isBody(c.rgb))

const pairs = source.slice(0, 3).map((from, i) => ({ from: from.rgb, to: target[i]?.rgb ?? from.rgb }))

const patched = Buffer.from(buffer)
let changed = 0

for (let i = 0; i < tableSize; i++) {
  const at = TABLE_AT + i * 3
  const rgb = [patched[at], patched[at + 1], patched[at + 2]]
  const pair = pairs.find((p) => p.from[0] === rgb[0] && p.from[1] === rgb[1] && p.from[2] === rgb[2])

  if (!pair) continue

  patched[at] = pair.to[0]
  patched[at + 1] = pair.to[1]
  patched[at + 2] = pair.to[2]
  changed++

  console.log(`  entry ${String(i).padStart(3)}  ${hex(rgb)} -> ${hex(pair.to)}`)
}

writeFileSync(outPath, patched)

console.log(`\n  ${changed} colours repainted, ${patched.length} bytes written to ${outPath}\n`)
