// The roster table in the README, generated.
//
// It points at the sprite files themselves rather than at pictures of them, so
// the gallery animates — a PNG contact sheet cannot, and the whole point of
// these sprites is that they move.
//
// That works because the residents' sprites are committed. The guests are still
// a cache and still ignored; see .gitignore.
//
// Usage: npm run gallery

import { readFileSync, writeFileSync } from 'node:fs'
import { relative } from 'node:path'
import { readFileSync as read } from 'node:fs'
import { ROOT } from './config.mjs'
import { decodeGif } from './gif.mjs'
import { decodeSprite } from './png.mjs'
import { prepare } from './prepare.mjs'
import { sharedBounds } from './render.mjs'
import { ROSTER, busyFile, idleFile, isFetched } from './roster.mjs'

// How tall the <img> must be for the *character* to land at this size.
//
// Two corrections, and the second is easy to miss. Frames are padded by wildly
// different amounts — Psyduck's supplied animation is a 600x640 canvas with the
// Pokemon filling barely half its height — so a fixed height draws a 34px
// Psyduck beside a 64px one.
//
// But measuring the *union* of all frames is wrong too: it grows to cover
// wherever the character moves, so anything that bobs or jumps measures taller
// than it is and comes out too small. Cubone's body is 38px inside a 43px union
// and rendered at 56 next to Psyduck's 64.
//
// The typical height of the body in a single frame is what actually matches.
const TARGET = 64

const bodyHeight = (image) => {
  const heights = image.frames
    .map((frame) => {
      let top = -1
      let bottom = -1

      for (let y = 0; y < image.height; y++) {
        for (let x = 0; x < image.width; x++) {
          if (frame.pixels[(y * image.width + x) * 4 + 3] <= 128) continue

          if (top < 0) top = y

          bottom = y
          break
        }
      }

      return bottom - top + 1
    })
    .filter((height) => height > 0)
    .sort((a, b) => a - b)

  // The median rather than the mean: one frame where the sprite is mid-blink or
  // half off the bottom should not set the size for the whole animation.
  return heights[Math.floor(heights.length / 2)] ?? image.height
}

const displayHeight = (path) => {
  try {
    const raw = read(path)
    const image = prepare(decodeSprite(raw) ?? decodeGif(raw), 0, null)

    return Math.round((TARGET * image.height) / bodyHeight(image))
  } catch {
    return TARGET
  }
}

const BEGIN = '<!-- gallery -->'
const END = '<!-- /gallery -->'

const rel = (path) => relative(ROOT, path)

const row = (entry) => {
  const kind = entry.busy ? 'own animation' : 'its shiny'

  return (
    `| **${entry.name}**<br><sub>${kind}</sub> ` +
    `| <img src="${rel(idleFile(entry.name))}" height="${displayHeight(idleFile(entry.name))}" alt="${entry.name} resting"> ` +
    `| <img src="${rel(busyFile(entry.name))}" height="${displayHeight(busyFile(entry.name))}" alt="${entry.name} working"> |`
  )
}

const present = ROSTER.filter((entry) => isFetched(entry.name))

const table = [
  BEGIN,
  '',
  '| | resting | working |',
  '| --- | --- | --- |',
  ...present.map(row),
  '',
  END,
].join('\n')

const readme = `${ROOT}/README.md`
const text = readFileSync(readme, 'utf8')
const from = text.indexOf(BEGIN)
const to = text.indexOf(END)

if (from === -1 || to === -1) {
  console.log(`\n  no ${BEGIN} ... ${END} markers in README.md\n`)
  process.exit(1)
}

const next = text.slice(0, from) + table + text.slice(to + END.length)

writeFileSync(readme, next)

console.log(`\n  ${present.length} residents in the README gallery${next === text ? ' (unchanged)' : ''}\n`)
