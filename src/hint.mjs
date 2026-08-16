// The closest Pokemon name to a flag the wrapper did not recognise, or nothing.
//
// Called from the shell function, which cannot do edit distance itself. It runs
// only for flags that are not Pokemon names — so `claude --resume` pays one
// node startup, about 25ms, and gets silence.
//
// Deliberately stricter than the same check inside Claude. In there a prompt of
// `--pikchu` can only have been aimed at the pane, so guessing generously is
// free. Out here the flag might be Claude's own: `--version` is two edits from
// Persian, and answering "did you mean --persian?" to a real flag is worse than
// missing a typo. One edit has no false positives across Claude's flag list,
// checked against all 27 of them.
//
// Prints the name alone, or nothing at all, so the caller can test for empty.
//
// Usage: run.sh src/hint.mjs <word>

import { nearest } from './switch.mjs'

const word = process.argv[2]

if (word) {
  const close = nearest(word, { maxEdits: 1 })

  // Never suggest what was typed. It read as a joke — `claude --brock` answering
  // "no such Pokemon brock — did you mean --brock?" — and it happened because
  // the shell wrapper's list of residents was written when it was installed,
  // while this runs fresh and knew about Brock. The wrapper reads the roster now
  // and cannot fall behind, but a suggestion identical to the word is nonsense
  // whatever caused it.
  if (close && close.toLowerCase() !== word.trim().toLowerCase()) process.stdout.write(close)
}
