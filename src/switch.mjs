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

  // Leading dashes on the argument are dropped. Every other command here is
  // `--something`, so `--dex --current` is the natural thing to type — and it
  // used to be taken literally, searching for a Pokemon named "--current" and
  // answering `nothing matches "--current"`, which reads as the command being
  // broken rather than the argument being spelled a way it did not expect.
  //
  // Only leading ones. A trailing dash is meaningful — `--dex pikachu-` is a
  // search for every Pikachu form rather than a lookup of Pikachu itself.
  if (dex) return { kind: 'dex', query: (dex[1] ?? '').trim().replace(/^-+/, '') }

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

  return `no such one: ${result.word}\n\n${list}${rest}`
}
