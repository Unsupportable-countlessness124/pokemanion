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
import { ROOT } from './config.mjs'
import { ROSTER, busyFile, idleFile, isFetched } from './roster.mjs'

const BEGIN = '<!-- gallery -->'
const END = '<!-- /gallery -->'

const rel = (path) => relative(ROOT, path)

const row = (entry) => {
  const kind = entry.busy ? 'own animation' : 'its shiny'

  return (
    `| **${entry.name}**<br><sub>${kind}</sub> ` +
    `| <img src="${rel(idleFile(entry.name))}" height="64" alt="${entry.name} resting"> ` +
    `| <img src="${rel(busyFile(entry.name))}" height="64" alt="${entry.name} working"> |`
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
