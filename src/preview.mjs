// Prints every frame of a sprite so you can eyeball the decode and the size.
//
// Usage: node src/preview.mjs assets/pikachu-showdown.gif [cellWidth] [cellHeight]

import { readFileSync } from 'node:fs'
import { decodeGif } from './gif.mjs'
import { decodeSprite } from './png.mjs'
import { renderFrames, sharedBounds } from './render.mjs'

const [file, widthArg, heightArg] = process.argv.slice(2)

if (!file) {
  console.error('usage: node src/preview.mjs <sprite.gif> [cellWidth] [cellHeight]')
  process.exit(1)
}

const cellWidth = Number(widthArg) || null
const cellHeight = Number(heightArg) || 8

const raw = readFileSync(file)
const gif = decodeSprite(raw) ?? decodeGif(raw)
const bounds = sharedBounds(gif.frames, gif.width, gif.height)

console.log(
  `\n${file}  ${gif.width}x${gif.height}  ${gif.frames.length} frames  ` +
    `content ${bounds.width}x${bounds.height} at ${bounds.x},${bounds.y}  ` +
    `-> ${cellWidth}x${cellHeight} cells\n`,
)

const rendered = renderFrames(gif, {
  rows: cellHeight,
  cols: cellWidth || null,
  sampler: process.env.SAMPLER || 'mode',
  style: process.env.STYLE || 'half',
}).frames

rendered.forEach((frame, index) => {
  console.log(`  frame ${index + 1}/${rendered.length}  ${frame.delay}ms`)

  for (const row of frame.rows) console.log(`  ${row}`)

  console.log('')
})
