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
// A fixed height is wrong, because these frames are padded by wildly different
// amounts: Psyduck's supplied animation is a 600x640 canvas with the Pokemon
// filling barely half its height, so `height="64"` drew a 34px Psyduck next to
// a 64px one. Measuring the artwork inside the frame is the only way they come
// out the same size.
const TARGET = 64

const displayHeight = (path) => {
  try {
    const raw = read(path)
    const image = prepare(decodeSprite(raw) ?? decodeGif(raw), 0, null)
    const box = sharedBounds(image.frames, image.width, image.height)

    return Math.round(TARGET / (box.height / image.height))
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
