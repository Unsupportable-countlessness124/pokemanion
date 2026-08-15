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

  if (close) process.stdout.write(close)
}
