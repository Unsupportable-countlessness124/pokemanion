// The Pokedex: what is available, and which of it is actually here.
//
// Twelve hundred names is not a list anyone can read, so the picker only ever
// showed the residents and a count. This is the other half — search by name,
// type or dex number, and see at a glance which are pinned, which are guests
// currently on disk, and which would be fetched on demand.
//
// The data is bundled rather than fetched: number, display name and types for
// every sprite the folder has, 51KB, built from Showdown's pokedex. Searching
// should not need the network any more than summoning should need a browser.
//
// Usage: npm run dex             a summary and what is on disk
//        npm run dex charizard   by name
//        npm run dex fire        by type
//        npm run dex 25          by number

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './config.mjs'
import { ROSTER, fetchedGuests, isResident, names, resolveName } from './roster.mjs'
import { speciesInUse } from './companion.mjs'
import { loadSprite } from './sprite.mjs'

const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const YELLOW = '\x1b[38;2;247;208;44m'
const GREEN = '\x1b[32m'
const RESET = '\x1b[0m'

// name -> [dex number, display name, "Type/Type"]
const DEX = JSON.parse(readFileSync(join(ROOT, 'assets', 'gen5-dex.json'), 'utf8'))

// The residents who are not Pokemon.
//
// Ash is the only one, and he is the whole reason this exists. The dex is built
// from Showdown's pokedex, which has no trainers in it, so `--dex ash` fell
// through to a substring search and answered with Aegislash, Rapidash, Whiscash
// and eight other names that merely contain "ash" — while the one resident
// actually called Ash was not among them. Something you can summon should be
// something you can look up.
//
// Read off the roster rather than kept here, so that adding a character is one
// entry in one file. Written twice, the two halves drift: the roster knew about
// Ash while every "did you mean" and the launch flag did not.
// Looked up on each call rather than snapshotted into a table at import time.
// A snapshot works only because the roster happens to be static by the time
// this module loads, which is a load-order dependency between two files that
// nothing states and nothing checks.
const cardFor = (name) => ROSTER.find((row) => row.name === name)?.card ?? null

const BLANK = { num: 0, types: '', height: 0, weight: 0, colour: '', abilities: '' }

export const entry = (name) => {
  const key = resolveName(name) ?? String(name ?? '').trim().toLowerCase()
  const off = cardFor(key)

  if (off) return { name: key, ...BLANK, ...off }

  const found = DEX[key]

  if (!found) return { name: key, title: key, ...BLANK }

  return {
    name: key,
    num: found[0],
    title: found[1],
    types: found[2],
    height: found[3],
    weight: found[4],
    colour: found[5],
    abilities: found[6],
  }
}

export const all = () => Object.keys(DEX).map(entry)

const TYPES = new Set(
  Object.values(DEX)
    .flatMap((row) => row[2].split('/'))
    .filter(Boolean)
    .map((type) => type.toLowerCase()),
)

// One query, three meanings, resolved in the order that surprises least: a
// number is a number, an exact type name is a type, anything else is a name to
// match loosely. Falling through means "fire" finds the type rather than only
// the four Pokemon with "fire" in their name.
// Picked fairly, but only from things that are actually Pokemon.
//
// The sprite folder carries more than the National Dex does: Pokestar Studios
// movie props from Black 2, Smogon's invented CAP Pokemon, and Alcremie's
// decorative variants. They all have a missing or negative dex number, which is
// the tell. Rolling "Pokestar UFO #-5001" is a bad surprise — it is not a
// Pokemon and nobody asked for a prop — so they are excluded from the dice
// while staying summonable by name.
const REAL = Object.keys(DEX).filter((name) => DEX[name][0] > 0)

export const pickRandom = () => REAL[Math.floor(Math.random() * REAL.length)]

export const search = (query) => {
  const text = String(query ?? '').trim().toLowerCase()

  if (!text) return []

  // Safe as keywords: nothing is named "random" or "current", and neither is a
  // type, so they cannot shadow a real search.
  if (text === 'random') return [entry(pickRandom())]

  if (text === 'current') return currentlyOut().map(entry)

  if (/^\d+$/.test(text)) {
    const num = Number(text)

    return all().filter((row) => row.num === num)
  }

  if (TYPES.has(text)) {
    return all().filter((row) => row.types.toLowerCase().split('/').includes(text))
  }

  const exact = resolveName(text)
  const loose = all().filter((row) => row.name.includes(text) || row.title.toLowerCase().includes(text))

  // An exact hit is what was almost certainly meant, so it leads.
  if (exact && loose.some((row) => row.name === exact)) {
    return [entry(exact), ...loose.filter((row) => row.name !== exact)]
  }

  return loose
}

// Whatever the panes are showing right now, newest claim first.
//
// Read from the claim files rather than from the roster, because that is the
// only thing that knows: the pane may have been switched with `--squirtle`,
// handed a guest, or rolled at random since it opened.
export const currentlyOut = () => {
  const held = [...speciesInUse()]

  return held.filter((name) => DEX[name] || resolveName(name))
}

// Did the query name one Pokemon outright?
//
// This exists because searching for the famous ones was the worst case:
// "pikachu" matches twelve rows, eleven of them costume variants — Pikachu-Alola,
// Pikachu-Hoenn, Pikachu-World — so the one you meant was buried in a list of
// hats and you could never reach its card. An exact name is not a search, it is
// a lookup, and it should answer with the thing itself.
export const exactMatch = (query) => {
  const text = String(query ?? '').trim().toLowerCase()

  // Numbers, types and the dice are genuine searches, not names.
  if (!text || text === 'random' || text === 'current' || /^\d+$/.test(text) || TYPES.has(text)) return null

  // A trailing dash asks for the forms — `pikachu-` means Pikachu-Alola and the
  // rest, which is what the card itself suggests typing. Without this it is not
  // a search at all: name resolution forgives punctuation, so `pikachu-` comes
  // back as `pikachu` and answers with the very card you were leaving.
  if (text.endsWith('-')) return null

  // Before name resolution, which only knows the sprite folder and so has never
  // heard of a trainer.
  if (cardFor(text)) return text

  const name = resolveName(text)

  return name && DEX[name] ? name : null
}

export const statusOf = (name, guests = fetchedGuests()) => {
  if (isResident(name)) return 'resident'

  return guests.includes(name) ? 'on disk' : 'available'
}

const MARK = {
  resident: `${GREEN}*${RESET}`,
  'on disk': `${YELLOW}.${RESET}`,
  available: ' ',
}

// `colour` is off when this goes through a hook, where the output is shown as
// a plain block of blocking-reason text and escape codes would be printed
// literally rather than interpreted.
export const render = (rows, limit = 40, colour = true) => {
  const guests = fetchedGuests()
  const shown = rows.slice(0, limit)
  const out = []
  const paint = (code, text) => (colour ? `${code}${text}${RESET}` : text)

  for (const row of shown) {
    const status = statusOf(row.name, guests)
    const mark = colour ? MARK[status] : { resident: '*', 'on disk': '.', available: ' ' }[status]

    out.push(
      `  ${mark} ${paint(DIM, String(row.num || '—').padStart(4))} ` +
        `${row.title.padEnd(24)} ${paint(DIM, row.types.padEnd(16))} ` +
        `--${row.name}`,
    )
  }

  if (rows.length > shown.length) {
    out.push(colour ? `  ${DIM}...and ${rows.length - shown.length} more${RESET}` : `  ...and ${rows.length - shown.length} more`)
  }

  return out.join('\n')
}

// The long form, for when there is exactly one answer — a search that landed on
// a single Pokemon, or a random pick. A row in a table is the right shape for
// scanning twenty results and the wrong shape for looking at one.
// Greedy, at a width that suits a chat message rather than a terminal — this
// card is read in both, and the narrower of the two wins.
const wrap = (text, width = 66) => {
  const lines = []
  let line = ''

  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }

  if (line) lines.push(line)

  return lines
}

export const detail = (row, colour = true) => {
  const paint = (code, text) => (colour ? `${code}${text}${RESET}` : text)
  const status = statusOf(row.name)

  // Someone with a description instead of a dex number. The fact table is the
  // wrong shape for him — type, size and ability are all "unknown", which reads
  // as a broken record rather than as a person.
  if (row.blurb) {
    const facts = [...(row.facts ?? []), ['sprite', status]]

    return (
      `  ${paint(BOLD, row.title)}\n\n` +
      wrap(row.blurb)
        .map((line) => `    ${line}`)
        .join('\n') +
      '\n\n' +
      facts.map(([label, value]) => `    ${paint(DIM, label.padEnd(8))}${value}`).join('\n') +
      `\n\n  ${paint(YELLOW, `--${row.name}`)} to summon it`
    )
  }

  const facts = [
    ['no.', row.num ? `#${row.num}` : 'not in the dex'],
    ['type', row.types || 'unknown'],
    ['size', row.height ? `${row.height}m, ${row.weight}kg` : 'unknown'],
    ['colour', row.colour || 'unknown'],
    ['ability', row.abilities || 'unknown'],
    ['sprite', status === 'available' ? 'fetched when you summon it' : status],
  ]

  return (
    `  ${paint(BOLD, row.title)}\n\n` +
    facts.map(([label, value]) => `    ${paint(DIM, label.padEnd(8))}${value}`).join('\n') +
    `\n\n  ${paint(YELLOW, `--${row.name}`)} to summon it`
  )
}

// The card as it goes in the sprite pane: four lines, because that is how many
// rows the pane has, and no colour codes because they are written straight into
// a cell grid alongside an image.
//
// Everything the long card says, minus the labels — at a glance beside the
// Pokemon itself, the labels are the part you can infer.
export const paneCard = (row, rows = 4) =>
  (row.pane
    ? row.pane
    : [
        `${row.title}  #${row.num || '?'}`,
        [row.types, row.colour].filter(Boolean).join('  '),
        row.height ? `${row.height}m  ${row.weight}kg` : '',
        row.abilities,
      ]
  )
    .filter(Boolean)
    .slice(0, rows)

// A Pokeball bobbing next to the card.
//
// Only in a real terminal. Inside Claude the same text arrives as a hook's
// blocking reason, which is rendered as plain text — an image escape sequence
// there would be printed literally rather than drawn.
//
// The card is written first and the ball placed beside it afterwards, by moving
// the cursor back up: the graphics protocol draws at the cursor, so the text
// has to have claimed its lines before anything can sit alongside them.
const BALL_ROWS = 5
const BALL_COL = 46
const BALL_LOOPS = 3

export const floatBall = async (lines) => {
  if (!process.stdout.isTTY) return

  let ball

  try {
    ball = loadSprite('assets/20-pokeball-floating.gif', 'dexball', BALL_ROWS, null)
  } catch {
    return
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const top = Math.max(0, lines - 2)

  for (let loop = 0; loop < BALL_LOOPS; loop++) {
    for (let i = 0; i < ball.frames.length; i++) {
      // Up to the card, across to the margin, draw, then back down to where the
      // prompt belongs — so the shell returns to a sane cursor either way.
      process.stdout.write(
        `\x1b[${top}A\x1b[${BALL_COL}G\x1b_Ga=d\x1b\\${ball.frames[i]}\x1b[${top}B\r`,
      )

      await sleep(Math.max(60, ball.delays[i]))
    }
  }
}

export const summary = () => {
  const guests = fetchedGuests()

  return (
    `  ${BOLD}${all().length}${RESET} Pokemon available\n` +
    `  ${GREEN}*${RESET} ${names().length} residents ${DIM}(always here)${RESET}   ` +
    `${YELLOW}.${RESET} ${guests.length} guests on disk   ` +
    `${DIM}${all().length - names().length - guests.length} more on request${RESET}`
  )
}

if (process.argv[1] && process.argv[1].endsWith('dex.mjs')) {
  // `npm run dex -- fire` strips the separator, but running the file directly
  // does not, and a stray `--` would silently become part of the search.
  const query = process.argv.slice(2).filter((arg) => arg !== '--').join(' ')

  console.log()

  if (!query) {
    console.log(summary())
    console.log()
    console.log(render([...names().map(entry), ...fetchedGuests().map(entry)]))
    console.log(`\n  ${DIM}search: npm run dex -- charizard | fire | 25${RESET}\n`)
  } else {
    const found = search(query)

    // Asked before the empty-search bail rather than after it: someone who is
    // not in the dex has nothing to substring-match against, so the later order
    // would report "nothing matches" for a name that resolves perfectly well.
    // "ash" happens to match eleven Pokemon and would have survived either way,
    // which is exactly the kind of luck not to build on.
    const hit = exactMatch(query)

    if (found.length === 0 && !hit) {
      // Imported here rather than at the top: switch.mjs imports from this
      // file, and pulling it in at module scope would close the circle.
      const { suggest } = await import('./switch.mjs')
      const meant = suggest(query)

      console.log(
        query.trim().toLowerCase() === 'current'
          ? `  ${DIM}no sprite pane is running${RESET}\n`
          : `  ${DIM}nothing matches "${query}"${RESET}\n` + (meant ? `  ${DIM}did you mean:${RESET} npm run dex -- ${meant.slice(6)}\n` : ''),
      )
      process.exit(1)
    }

    // An exact name, or a single answer, gets the card. Several get the table.
    if (hit || found.length === 1) {
      const row = hit ? entry(hit) : found[0]

      // Forms, not merely the other things that matched. The follow-up this
      // prints is `dex -- <name>-`, which searches the prefix, so anything that
      // does not carry the prefix is not something that line can find: `--dex
      // mew` counted Mewtwo as a form of Mew and pointed at `mew-`, which
      // answers with nothing, and `--dex ash` counted Aegislash and Whiscash.
      const others = found.filter((other) => other.name.startsWith(`${row.name}-`)).length
      const card = detail(row)

      console.log(card)

      if (others > 0) {
        console.log(`\n  ${DIM}${others} other form${others === 1 ? '' : 's'} — npm run dex -- ${row.name}-${RESET}`)
      }

      console.log()
      await floatBall(card.split('\n').length + (others > 0 ? 3 : 1))
    } else {
      console.log(render(found))
      console.log(`\n  ${DIM}${found.length} found — summon with claude --<name>, or --<name> inside Claude${RESET}\n`)
    }
  }
}
