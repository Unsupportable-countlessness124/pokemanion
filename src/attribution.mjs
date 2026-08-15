// Keeps ATTRIBUTION.md honest.
//
// The artwork ships with this project, so the file naming its sources is the
// one thing that must never quietly go stale — and a hand-maintained table of
// files is exactly the sort of thing that does. Sprites arrive a few at a time,
// get wired into the roster, and the list is forgotten.
//
// So the table is generated from what is actually on disk and what the roster
// actually points at. Adding a GIF and forgetting to mention it is no longer
// possible; the check just fails.
//
// Usage: npm run attribution          rewrite the table
//        npm run attribution -- --check   fail if it is out of date

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './config.mjs'
import { ROSTER } from './roster.mjs'

const DOC = join(ROOT, 'ATTRIBUTION.md')
const BEGIN = '<!-- files -->'
const END = '<!-- /files -->'

// Which roster entries use a given file, and for which half. A sprite can be
// both — Charizard's normal sprite rests while its shiny is kept for later.
const usage = () => {
  const map = new Map()

  const note = (file, text) => {
    if (!file) return

    const name = file.replace(/^assets\//, '')

    map.set(name, [...(map.get(name) ?? []), text])
  }

  for (const entry of ROSTER) {
    note(entry.idle, `${entry.name} resting`)
    note(entry.busy, `${entry.name} working`)
  }

  // Not everything is reached through the roster. The Pokeballs are named in
  // the pane and the Pokedex; the status-line sprite is named in config.json.
  // Reporting those as unused was the first thing this generator got wrong.
  const where = [
    ['src', 'the pane'],
    ['bin', 'the pane'],
  ]

  for (const [dir, label] of where) {
    for (const file of readdirSync(join(ROOT, dir))) {
      if (!file.endsWith('.mjs')) continue

      // Comment lines stripped first: a sprite named in a comment as "the
      // alternative we did not use" is not a use, and counting it reported two
      // files as live that nothing draws.
      const text = readFileSync(join(ROOT, dir, file), 'utf8')
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n')

      for (const asset of readdirSync(join(ROOT, 'assets'))) {
        // Skipped when a roster entry already accounts for it — roster.mjs
        // naming the file it points at is the same fact said twice.
        if (map.has(asset) && file === 'roster.mjs') continue

        if (text.includes(`assets/${asset}`)) note(asset, `${label} (${file})`)
      }
    }
  }

  try {
    const config = readFileSync(join(ROOT, 'config.json'), 'utf8')

    for (const asset of readdirSync(join(ROOT, 'assets'))) {
      if (map.has(asset)) continue

      if (config.includes(`assets/${asset}`)) note(asset, 'config.json')
    }
  } catch {}

  return map
}

export const table = () => {
  const used = usage()

  const files = readdirSync(join(ROOT, 'assets'))
    .filter((file) => /\.(gif|png)$/.test(file))
    .sort((a, b) => (Number(a.split('-')[0]) || 0) - (Number(b.split('-')[0]) || 0))

  const rows = files.map((file) => {
    const where = used.get(file)

    return `| \`${file}\` | ${where ? [...new Set(where)].join(', ') : 'kept, not currently used'} |`
  })

  return [BEGIN, '', '| file | used for |', '| --- | --- |', ...rows, '', `${files.length} files.`, '', END].join('\n')
}

const current = () => {
  const text = readFileSync(DOC, 'utf8')
  const from = text.indexOf(BEGIN)
  const to = text.indexOf(END)

  if (from === -1 || to === -1) throw new Error(`ATTRIBUTION.md has no ${BEGIN} ... ${END} markers`)

  return { text, from, to: to + END.length }
}

export const write = () => {
  const { text, from, to } = current()
  const next = `${text.slice(0, from)}${table()}${text.slice(to)}`

  writeFileSync(DOC, next)

  return next !== text
}

if (process.argv[1] && process.argv[1].endsWith('attribution.mjs')) {
  const { text, from, to } = current()
  const stale = text.slice(from, to) !== table()

  if (process.argv.includes('--check')) {
    console.log(stale ? '\n  ATTRIBUTION.md is out of date — run: npm run attribution\n' : '\n  ATTRIBUTION.md is up to date\n')
    process.exit(stale ? 1 : 0)
  }

  console.log(write() ? '\n  ATTRIBUTION.md updated\n' : '\n  ATTRIBUTION.md already up to date\n')
}
