// Changing Pokemon without leaving Claude.
//
// `claude --pikachu` only works at the moment you start Claude, because it is
// the shell function that lifts the flag out and the real binary never sees it.
// Once you are inside a session the same words are just text, and there is
// nowhere for them to go.
//
// So the UserPromptSubmit hook reads them. A prompt that is nothing but
// `--pikachu` is treated as an instruction to the pane rather than a message to
// Claude: the species is written to the claim file the pane already watches, and
// the prompt is blocked so it never reaches the model and never costs a turn.
//
// Only a prompt that is *entirely* the flag counts. Asking Claude about
// `--pikachu` in a sentence is a real question and has to stay one.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './config.mjs'
import { available, resolveName } from './roster.mjs'

// `--pokemon` and its plural list; `--<name>` switches. Anything else that
// looks like a bare flag is a typo worth answering, since the alternative is
// silently sending "--pikchu" to Claude as a prompt.
//
// `pool` is only the residents. Any of the twelve hundred names the sprite
// folder has is accepted too — they are simply fetched on the way in — so the
// check is against every known name rather than against what is on disk.
export const parse = (prompt, pool = available()) => {
  const text = String(prompt ?? '').trim()

  // The one command that takes an argument, so it is matched before the
  // single-word forms. `--dex` alone is the summary; `--dex fire` searches.
  const dex = text.match(/^--dex(?:\s+(.+))?$/i)

  // The argument is taken exactly as typed. `--dex --current` is a miss, not a
  // silent correction: one way to write a command is easier to remember than
  // one way plus a set of things that happen to also work. The miss is where
  // the help goes — see `suggest` below, which is what turns it from a dead end
  // into a pointer.
  if (dex) return { kind: 'dex', query: (dex[1] ?? '').trim() }

  const match = text.match(/^--([a-z][a-z0-9.:-]*)$/i)

  if (!match) return null

  const word = match[1].toLowerCase()

  if (word === 'pokemon' || word === 'pokemons') return { kind: 'list' }

  // Resolved to an actual name by the caller, not here, so that parsing stays
  // a pure reading of the text and the dice are rolled once.
  if (word === 'random') return { kind: 'random' }

  if (pool.includes(word)) return { kind: 'switch', name: word }

  const resolved = resolveName(word)

  if (resolved) return { kind: 'switch', name: resolved, guest: true }

  return { kind: 'unknown', word }
}

// Real Pokemon that this cannot show, and the reason they are missing.
//
// The sprites are Gen 5 animations, and Gen 5 ended at #649. Everything after
// it exists only where an artist went back and drew it in that style, which
// they did for most of Gen 6 and 7 and much less of Gen 8 and 9. So `--urshifu`
// is not a typo — it is a correctly spelled Pokemon that was never drawn.
//
// Without this list the two are indistinguishable, because the bundled dex only
// contains what has a sprite: a name that is missing from it is missing whether
// it is a Pokemon or nonsense. 159 names is a small price for telling someone
// they spelled it right.
//
// Generated once by diffing the national dex (PokeAPI's species list, 1025
// entries) against the names this project can resolve. If a new sprite set ever
// lands, that diff is how to rebuild it — there is no script, because it is a
// thing that happens roughly never.
const UNREGISTERED = JSON.parse(readFileSync(join(ROOT, 'assets', 'no-gen5-sprite.json'), 'utf8'))

const UNREGISTERED_BY_NAME = new Map(UNREGISTERED.map((row) => [row.n, row]))

export const unregistered = (word) => {
  const key = String(word ?? '').trim().toLowerCase()

  if (!key) return null

  // Their names carry hyphens the way ours do not, so try both spellings.
  const row = UNREGISTERED_BY_NAME.get(key) ?? UNREGISTERED.find((entry) => entry.n.replace(/[^a-z0-9]/g, '') === key.replace(/[^a-z0-9]/g, ''))

  if (!row) return null

  return { name: row.n, num: row.d, title: row.n.replace(/(^|-)([a-z])/g, (_, dash, letter) => (dash ? '-' : '') + letter.toUpperCase()) }
}

// What the user probably meant, when `--dex <something>` matched nothing.
//
// The command is strict on purpose — one spelling is easier to remember than
// one spelling plus a set of near-misses that happen to work — so the help has
// to live in the failure. `--dex --current` is the case that prompted this:
// every other command here is `--something`, so the dash is a habit, and
// `nothing matches "--current"` reads as a broken command rather than a typo.
//
// Returns null when there is nothing useful to say, so the caller can leave the
// plain miss alone rather than pad it with a guess.
export const suggest = (query, pool = available()) => {
  const text = String(query ?? '').trim()

  // Only leading dashes are ever a mistake. A trailing one is real syntax —
  // `--dex pikachu-` asks for every Pikachu form — so a query that only differs
  // by its tail is not a typo and gets no suggestion.
  const stripped = text.replace(/^-+/, '')

  if (!stripped || stripped === text) return null

  // Worth suggesting only if the corrected form actually leads somewhere.
  // Pointing at a second miss is worse than saying nothing.
  const word = stripped.toLowerCase()
  const leadsSomewhere =
    word === 'current' || word === 'random' || pool.includes(word) || Boolean(resolveName(word)) || /^\d+$/.test(word)

  return leadsSomewhere ? `--dex ${stripped}` : null
}

// Written to stderr, which is what Claude Code shows when a hook blocks a
// prompt. Kept short: it lands in the transcript where the message would have.
export const describe = (result, pool = available(), current = null, extra = 0) => {
  if (result.kind === 'switch') {
    // A rolled one says what it rolled. "flygon it is" after asking for a
    // surprise tells you the name but not that it was a surprise, nor what the
    // thing actually is.
    if (result.rolled) return `rolled ${result.rolled}\n\n${result.name} it is`

    return result.name === current ? `${result.name} already` : `${result.name} it is`
  }

  const list = pool.map((name) => (name === current ? `${name} (current)` : name)).join('  ')

  // The residents are worth listing; the twelve hundred guests are not. Saying
  // how many there are, and that any of them can be named, is the useful part.
  const rest = extra > 0 ? `\n\n...or name any of ${extra} others — they are fetched on the spot` : ''

  if (result.kind === 'list') return `${list}\n\ntype --<name> to switch${rest}`

  // A real Pokemon that simply has no sprite reads as a typo otherwise, and it
  // is the opposite: you spelled it correctly and it does not exist *here*.
  // The Pokedex has a word for that, so it may as well use it.
  const known = unregistered(result.word)

  if (known) {
    return (
      `${known.title} — #${known.num}, no data\n\n` +
      `Gen 5 ended at #649 and nothing after it was ever drawn in this style. ` +
      `${UNREGISTERED.length} species are missing for that reason.\n\n${list}${rest}`
    )
  }

  return `no such one: ${result.word}\n\n${list}${rest}`
}
