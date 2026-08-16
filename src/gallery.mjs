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
import { ROSTER, busyFile, idleFile, isFetched, knownCount } from './roster.mjs'

// Width, not height — and that is not a style choice.
//
// GitHub rewrites every image in a README with `style="height: auto;
// max-height: Npx"`, so a height attribute can only ever shrink an image, never
// enlarge one. A 38x46 Psyduck rendered at 46px however large the number said,
// while a 600x640 animation beside it obeyed its cap and towered over it. Three
// rounds of raising the number changed nothing, because nothing was being
// applied. Width has no such override.
//
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
const TARGET = 66

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

const displayWidth = (path) => {
  try {
    const raw = read(path)
    const image = prepare(decodeSprite(raw) ?? decodeGif(raw), 0, null)

    const frameHeight = (TARGET * image.height) / bodyHeight(image)

    // Converted to a width at the end, because that is the attribute that works.
    return Math.round((frameHeight * image.width) / image.height)
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
    `| <img src="${rel(idleFile(entry.name))}" width="${displayWidth(idleFile(entry.name))}" alt="${entry.name} resting"> ` +
    `| <img src="${rel(busyFile(entry.name))}" width="${displayWidth(busyFile(entry.name))}" alt="${entry.name} working"> |`
  )
}

const present = ROSTER.filter((entry) => isFetched(entry.name))

const table = [
  BEGIN,
  '',
  '| | resting | working |',
  '| --- | :---: | :---: |',
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

console.log(`\n  ${present.length} residents in the README gallery${next === text ? ' (unchanged)' : ''}`)

// And the counts, which are prose rather than a table.
//
// They were maintained by hand and drifted every time: 1238 guests when there
// were 1242, "14 ship with it" when fifteen did, a cache figure out by a factor
// of three. Adding a character should not mean remembering six numbers across
// two files, so they are written from the roster here — and the suite fails if
// they are ever wrong.
const residents = ROSTER.length
const summonable = knownCount() + ROSTER.filter((entry) => entry.card).length
const guests = summonable - residents

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty']
const spelled = WORDS[residents] ?? String(residents)
const Spelled = spelled[0].toUpperCase() + spelled.slice(1)
const anyWord = WORDS.join('|')

const counts = [
  [new RegExp(`\\b(?:${anyWord}) hand-tuned residents`, 'gi'), `${Spelled} hand-tuned residents`],
  [/\*\*\d+ more\*\*/g, `**${guests} more**`],
  [new RegExp(`All (?:${anyWord}) residents`, 'gi'), `All ${spelled} residents`],
  [/the \d+ in `src\/roster\.mjs`/g, `the ${residents} in \`src/roster.mjs\``],
  [/the other \d+\./g, `the other ${guests}.`],
  [/any of the \d+/g, `any of the ${summonable}`],
  [/^\d+ ship with it, \d+ more/m, `${residents} ship with it, ${guests} more`],
  // The plugin manifests, which are the first thing anyone reads about this.
  [/\d+ built in, \d+ summonable/g, `${residents} built in, ${guests} summonable`],
  [/\d+ ship with it and \d+ more/g, `${residents} ship with it and ${guests} more`],
]

for (const file of ['README.md', 'CLAUDE.md', '.claude-plugin/marketplace.json', '.codex-plugin/plugin.json']) {
  const path = `${ROOT}/${file}`
  const before = readFileSync(path, 'utf8')
  const after = counts.reduce((body, [pattern, replacement]) => body.replace(pattern, replacement), before)

  if (after !== before) writeFileSync(path, after)
}

console.log(`  ${residents} residents, ${guests} guests, ${summonable} summonable — counts written\n`)
