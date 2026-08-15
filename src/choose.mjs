// The picker behind `claude --pokemon`.
//
// Prints a numbered list, reads a number, and writes the chosen name to stdout
// and nothing else — because the shell function calls this inside a command
// substitution and whatever lands on stdout becomes the answer. The list, the
// prompt and any complaint all go to stderr, which the substitution leaves
// attached to the terminal, so you see them while stdout stays clean.
//
// Exit codes matter to the caller:
//   0 with a name    summon that one
//   0 with nothing    you pressed enter — carry on under the usual rules
//   1                 you gave up, so do not start Claude at all
//
// Usage: npm run choose

import { createInterface } from 'node:readline'
import { createReadStream } from 'node:fs'
import { available, ensure, knownCount, resolveName } from './roster.mjs'

const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const YELLOW = '\x1b[38;2;247;208;44m'
const RESET = '\x1b[0m'

const say = (line = '') => process.stderr.write(`${line}\n`)

// Just the list. Which ones happen to be out elsewhere, and which one the
// rotation would otherwise have landed on, are not the question being asked —
// you are picking, and anything is pickable.
export const render = (names) => {
  const width = String(names.length).length

  say()
  say(`  ${BOLD}Which one?${RESET}`)
  say()

  names.forEach((name, index) => {
    say(`   ${YELLOW}${String(index + 1).padStart(width)}${RESET}  ${name}`)
  })

  say()

  // The residents are the list; the guests are a number. Printing twelve
  // hundred names would bury the ones actually worth picking from, and they are
  // reachable by name anyway — `claude --flygon` fetches it on the spot.
  const guests = knownCount() - names.length

  if (guests > 0) say(`  ${DIM}or type any other name — ${guests} more, fetched when first used${RESET}\n`)
}

// Reads from the terminal rather than from stdin, because stdin may be a pipe
// — and the whole point of a picker is that a person is there.
const ask = (question) =>
  new Promise((resolve) => {
    const input = process.stdin.isTTY ? process.stdin : createReadStream('/dev/tty')
    const rl = createInterface({ input, output: process.stderr, terminal: true })

    // Both endings run through here, and only the first one counts. Closing the
    // interface emits 'close' synchronously, so an answer that closed up after
    // itself would otherwise be overtaken by its own close handler and every
    // reply would read as a walk-out.
    let done = false

    const finish = (value) => {
      if (done) return

      done = true

      rl.close()

      if (input !== process.stdin) input.destroy()

      resolve(value)
    }

    rl.question(question, finish)
    rl.on('close', () => finish(null))
  })

export const parse = (answer, names) => {
  const trimmed = String(answer ?? '').trim()

  if (trimmed === '') return { kind: 'default' }

  // A name works as well as its number. Someone who has just read a list of
  // names is quite likely to type one.
  const named = names.find((name) => name.toLowerCase() === trimmed.toLowerCase())

  if (named) return { kind: 'chosen', name: named }

  if (!/^\d+$/.test(trimmed)) {
    // Not on the list and not a number — it may still be one of the twelve
    // hundred others, which are named rather than numbered.
    const guest = resolveName(trimmed)

    if (guest) return { kind: 'chosen', name: guest, guest: true }

    return { kind: 'bad', why: `"${trimmed}" is not a number or a Pokemon` }
  }

  const index = Number(trimmed)

  if (index < 1 || index > names.length) return { kind: 'bad', why: `${index} is not on the list` }

  return { kind: 'chosen', name: names[index - 1] }
}

export const chooseInteractive = async () => {
  const names = available()

  if (names.length === 0) {
    say(`\n  ${DIM}no sprites fetched — run: npm run roster${RESET}\n`)

    return 1
  }

  render(names)

  for (let attempt = 0; attempt < 3; attempt++) {
    // Both ways out are spelled out, because they mean different things and
    // only one of them is guessable. Enter starts Claude anyway; ctrl-c starts
    // nothing, which is the only thing ctrl-c should ever do.
    const answer = await ask(`  ${DIM}number, enter for the usual, ctrl-c to cancel:${RESET} `)

    if (answer === null) {
      say()

      return 1
    }

    const result = parse(answer, names)

    if (result.kind === 'default') {
      say()

      return 0
    }

    if (result.kind === 'chosen') {
      // A guest has no files yet, and the pane will not draw a species it
      // cannot find. Fetching here, before the name is handed over, is what
      // makes picking one indistinguishable from picking a resident.
      if (result.guest) {
        say(`  ${DIM}fetching ${result.name}...${RESET}`)

        if (!ensure(result.name)) {
          say(`  ${DIM}could not fetch ${result.name}${RESET}`)

          continue
        }
      }

      say(`\n  ${YELLOW}${result.name}${RESET} it is.\n`)
      process.stdout.write(result.name)

      return 0
    }

    say(`  ${DIM}${result.why}${RESET}`)
  }

  say(`\n  ${DIM}giving up${RESET}\n`)

  return 1
}

// `claude --random`: one of the 1252, fetched before the name is handed back so
// the pane never opens onto a species with no files. Same stdout contract as the
// picker — the name and nothing else.
export const chooseRandom = async () => {
  const { pickRandom, entry } = await import('./dex.mjs')

  // A few attempts, because a name can be in the sprite folder and still fail
  // to download, and silently starting Claude with no Pokemon would be a worse
  // answer than trying again.
  for (let attempt = 0; attempt < 5; attempt++) {
    const pick = pickRandom()
    const row = entry(pick)

    say(`\n  ${DIM}rolled${RESET} ${YELLOW}${row.title}${RESET} ${DIM}#${row.num || '?'} ${row.types}${RESET}`)

    if (ensure(pick)) {
      say()
      process.stdout.write(pick)

      return 0
    }

    say(`  ${DIM}could not fetch it, rolling again${RESET}`)
  }

  say(`\n  ${DIM}giving up${RESET}\n`)

  return 1
}

if (process.argv[1] && process.argv[1].endsWith('choose.mjs')) {
  process.exit(process.argv.includes('--random') ? await chooseRandom() : await chooseInteractive())
}
