// Prints one frame every way it can be drawn, so you can pick by looking.
//
// Usage: node src/compare.mjs [sprite.gif] [rows]

import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { decodeGif } from './gif.mjs'
import { decodeSprite } from './png.mjs'
import { renderFrames } from './render.mjs'
import { ROOT, loadConfig } from './config.mjs'

const config = loadConfig()
const [fileArg, rowsArg] = process.argv.slice(2)

const file = fileArg ?? config.sprite
const rows = Number(rowsArg) || config.rows
const path = isAbsolute(file) ? file : join(ROOT, file)

const raw = readFileSync(path)
const gif = decodeSprite(raw) ?? decodeGif(raw)
const frame = Math.min(4, gif.frames.length - 1)

console.log(`\n  ${file} — frame ${frame + 1}, asking for ${rows} rows\n`)

for (const style of ['half', 'quad', 'sextant', 'braille', 'blocks']) {
  for (const sampler of ['mode']) {
    const rendered = renderFrames(gif, { rows, sampler, style, snap: true, palette: config.palette })

    console.log(
      `  ── style ${style}, sampler ${sampler} ` +
        `(${rendered.cols}x${rendered.rows} cells, ${rendered.factor ?? '?'}x)`,
    )

    for (const row of rendered.frames[frame].rows) console.log(`     ${row}`)

    console.log('')
  }
}

console.log('  Set the winner in config.json, then: npm run build\n')
