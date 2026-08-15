// Which row counts are actually worth choosing for the current sprite.
//
// The reduction has to be a whole number, so row counts come in bands: every
// height inside a band reduces the sprite by the same amount and simply pads
// the leftover space. Only the smallest height in each band is worth using —
// the rest are bigger without being sharper.

import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { decodeGif } from './gif.mjs'
import { decodeSprite } from './png.mjs'
import { fitBounds, sharedBounds } from './render.mjs'
import { prepare } from './prepare.mjs'
import { ROOT, loadConfig } from './config.mjs'

const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const GREEN = '\x1b[32m'
const RESET = '\x1b[0m'

const config = loadConfig()
const path = isAbsolute(config.sprite) ? config.sprite : join(ROOT, config.sprite)

const raw = readFileSync(path)
const image = prepare(decodeSprite(raw) ?? decodeGif(raw), config.bounce)
const box = sharedBounds(image.frames, image.width, image.height)

const pixelsPerCell = config.style === 'blocks' ? 1 : { half: 2, quad: 2, sextant: 3, braille: 4 }[config.style] ?? 2

console.log(
  `\n  ${BOLD}${config.sprite}${RESET}${DIM} — ${box.width}x${box.height} pixels, ` +
    `style ${config.style} holds ${pixelsPerCell} per row${RESET}\n`,
)

console.log(`  ${'rows'.padStart(5)}  ${'reduction'.padEnd(11)} ${'sprite fills'.padEnd(13)} verdict`)

const seen = new Map()

for (let rows = 4; rows <= Math.ceil(box.height / pixelsPerCell) + 2; rows++) {
  const fit = fitBounds(box, rows, pixelsPerCell, box.width / box.height, 1)
  const fill = box.height / fit.bounds.height

  const first = !seen.has(fit.factor)

  if (first) seen.set(fit.factor, rows)

  const verdict = first
    ? `${GREEN}best height for ${fit.factor}x${RESET}`
    : `${DIM}same ${fit.factor}x as ${seen.get(fit.factor)} rows, just taller${RESET}`

  console.log(
    `  ${String(rows).padStart(5)}  ${(fit.factor + 'x').padEnd(11)} ${(Math.round(fill * 100) + '%').padEnd(13)} ${verdict}`,
  )
}

console.log(`\n  ${DIM}Only the green ones are worth picking. Set "rows", then: npm run build${RESET}\n`)
