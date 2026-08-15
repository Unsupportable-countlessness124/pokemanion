// Noticing that you pressed escape.
//
// Claude Code has no hook for an interruption. The last hook to fire still says
// "working", so on its own the sprite would keep running until the two minute
// timeout — which is the whole length of most interruptions.
//
// The one trace it does leave is in the session transcript: a user entry
// carrying an `interruptedMessageId` and the text "[Request interrupted by
// user]". Reading that is the only way to see an interruption at the moment it
// happens.
//
// Two callers read it two ways. The sprite window lives for the whole session
// and follows the file as it grows; the status line is a fresh process every
// second and reads the end of it. Both parse it here, so they cannot disagree
// about what counts.

import { closeSync, openSync, readSync, statSync } from 'node:fs'

// Whole lines only, and parsed rather than searched. The transcript records
// tool results verbatim, so any file Claude reads that mentions the key — this
// one, for instance — would otherwise look like an interruption.
export const scanLines = (text) => {
  let at = 0

  for (const line of text.split('\n')) {
    if (!line.startsWith('{') || !line.includes('interruptedMessageId')) continue

    try {
      const entry = JSON.parse(line)

      if (!entry.interruptedMessageId) continue

      // The transcript's own timestamp, not the clock now: the status line may
      // be reading this long after it was written.
      const stamp = Date.parse(entry.timestamp ?? '')

      at = Math.max(at, Number.isNaN(stamp) ? Date.now() : stamp)
    } catch {}
  }

  return at
}

// For processes that get one look. Reading the end is enough — an interruption
// that matters is the most recent thing in the file, and a whole transcript can
// run to several megabytes, which is not something to read every second.
export const tailInterruptAt = (path, bytes = 128 * 1024) => {
  if (!path) return 0

  try {
    const size = statSync(path).size
    const from = Math.max(0, size - bytes)
    const length = size - from

    if (length <= 0) return 0

    const handle = openSync(path, 'r')
    const buffer = Buffer.allocUnsafe(length)

    readSync(handle, buffer, 0, length, from)
    closeSync(handle)

    // Starting mid-file almost certainly starts mid-line; that partial line is
    // dropped by the parser, which only accepts lines beginning with a brace.
    return scanLines(buffer.toString('utf8'))
  } catch {
    return 0
  }
}
