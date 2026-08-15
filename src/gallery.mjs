// Renders the roster into pictures for the README.
//
// Most of the residents download their sprites into assets/pokemon/, which is
// gitignored — a cache, not source — so those files cannot be linked from a
// README that has to work on a fresh clone. This bakes each pair into one small
// PNG under docs/gallery/, which is committed.
//
// Generated rather than assembled by hand, because the roster changes and a
// gallery that has to be remade by hand is a gallery that goes stale.
//
// Usage: npm run gallery

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './config.mjs'
import { decodeGif } from './gif.mjs'
import { decodeSprite } from './png.mjs'
import { prepare } from './prepare.mjs'
import { encodePng } from './pngwrite.mjs'
import { sharedBounds } from './render.mjs'
import { ROSTER, busyFile, idleFile, isFetched } from './roster.mjs'

const OUT = join(ROOT, 'docs', 'gallery')

// Tall enough to read on a phone, small enough that fourteen of them are not a
// megabyte. The pane draws at about 68px; this is a shade over double that, so
// the pixel grid stays crisp when GitHub scales it down.
const HEIGHT = 72
const GAP = 14
const SCALE = 2

const load = (path) => {
  const raw = readFileSync(path)
  const image = prepare(decodeSprite(raw) ?? decodeGif(raw), 0, null)

  return { image, box: sharedBounds(image.frames, image.width, image.height) }
}

// One frame, nearest-neighbour to the target height — the same reduction the
// pane does, so what you see here is what the pane draws.
const cell = ({ image, box }, frameIndex) => {
  const height = HEIGHT
  const width = Math.max(1, Math.round((box.width / box.height) * height))
  const out = new Uint8Array(width * height * 4)
  const pixels = image.frames[Math.min(frameIndex, image.frames.length - 1)].pixels

  for (let y = 0; y < height; y++) {
    const sourceY = box.y + Math.min(box.height - 1, Math.floor((y * box.height) / height))

    for (let x = 0; x < width; x++) {
      const sourceX = box.x + Math.min(box.width - 1, Math.floor((x * box.width) / width))
      const from = (sourceY * image.width + sourceX) * 4

      out.set(pixels.subarray(from, from + 4), (y * width + x) * 4)
    }
  }

  return { width, height, pixels: out }
}

// Transparent background, so it sits on light and dark READMEs alike. Nothing
// is drawn behind the sprites at all.
const compose = (cells) => {
  const width = cells.reduce((total, c) => total + c.width, 0) + GAP * (cells.length - 1)
  const canvas = new Uint8Array(width * HEIGHT * 4)

  let offset = 0

  for (const c of cells) {
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const from = (y * c.width + x) * 4

        if (c.pixels[from + 3] === 0) continue

        canvas.set(c.pixels.subarray(from, from + 4), (y * width + offset + x) * 4)
      }
    }

    offset += c.width + GAP
  }

  const big = new Uint8Array(width * SCALE * HEIGHT * SCALE * 4)

  for (let y = 0; y < HEIGHT * SCALE; y++) {
    for (let x = 0; x < width * SCALE; x++) {
      const from = (Math.floor(y / SCALE) * width + Math.floor(x / SCALE)) * 4

      big.set(canvas.subarray(from, from + 4), (y * width * SCALE + x) * 4)
    }
  }

  return encodePng(big, width * SCALE, HEIGHT * SCALE)
}

mkdirSync(OUT, { recursive: true })

const made = []

for (const entry of ROSTER) {
  if (!isFetched(entry.name)) continue

  const idle = load(idleFile(entry.name))
  const busy = load(busyFile(entry.name))

  // A frame from partway in, because frame zero of an animation is usually the
  // rest pose and two rest poses side by side show nothing.
  const cells = [cell(idle, Math.floor(idle.image.frames.length / 3)), cell(busy, Math.floor(busy.image.frames.length / 2))]

  const file = join(OUT, `${entry.name}.png`)

  writeFileSync(file, compose(cells))
  made.push(entry.name)
}

// And the table that shows them, written into the README between markers —
// same reasoning as the credits list. A gallery whose captions are maintained
// by hand is a gallery that ends up describing the wrong Pokemon.
const BEGIN = '<!-- gallery -->'
const END = '<!-- /gallery -->'

const label = (name) => {
  const entry = ROSTER.find((e) => e.name === name)

  if (entry.busy) return 'own animation'

  return 'its shiny'
}

const rows = []

for (let i = 0; i < made.length; i += 2) {
  const pair = made.slice(i, i + 2)

  rows.push(
    '| ' +
      pair
        .map((name) => `**${name}** <br> <sub>${label(name)}</sub> | <img src="docs/gallery/${name}.png" width="230">`)
        .join(' | ') +
      (pair.length === 1 ? ' |  |  |' : ' |'),
  )
}

const table = [BEGIN, '', '| | | | |', '| --- | --- | --- | --- |', ...rows, '', END].join('\n')

const readme = join(ROOT, 'README.md')
const text = readFileSync(readme, 'utf8')
const from = text.indexOf(BEGIN)
const to = text.indexOf(END)

if (from !== -1 && to !== -1) {
  writeFileSync(readme, text.slice(0, from) + table + text.slice(to + END.length))
  console.log(`\n  ${made.length} pairs written to docs/gallery/, README table updated\n`)
} else {
  console.log(`\n  ${made.length} pairs written to docs/gallery/ (no ${BEGIN} markers in README)\n`)
}
