// Watches what the sprite window is deciding, and why.
//
// The window has one visible output — a Pokemon that is either running or not
// — so when it gets that wrong there is nothing to read. This runs the same
// decision against the same files and prints every change, so an interruption
// that fails to settle the sprite can be traced to the piece that missed it:
// the hook that never fired, the transcript entry that never arrived, or the
// comparison between them.
//
// Usage: npm run watch            every session
//        npm run watch <id>       one session

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { STATE_DIR, loadConfig, readState } from './config.mjs'
import { tailInterruptAt } from './interrupt.mjs'

const config = loadConfig()
const only = process.argv[2] ?? null
const SESSIONS = join(STATE_DIR, 'sessions')

const clock = () => new Date().toTimeString().slice(0, 8)
const ago = (at) => (at ? `${((Date.now() - at) / 1000).toFixed(1)}s ago` : 'never')

const sessions = () => {
  try {
    return readdirSync(SESSIONS)
      .filter((f) => f.endsWith('.json') && !f.endsWith('.beat.json'))
      .map((f) => f.slice(0, -'.json'.length))
      .filter((id) => !only || id.startsWith(only))
  } catch {
    return []
  }
}

// Exactly what src/window.mjs computes, kept deliberately close to it.
//
// `key` is what the line is deduplicated on, so it must not contain anything
// that moves on its own — an elapsed time in there makes every poll look like a
// change and the log becomes a wall.
const verdict = (state) => {
  if (!state) return { running: false, key: 'no-state', why: 'no state file' }

  if (state.state !== 'working') {
    return { running: false, key: `state-${state.state}`, why: `state is "${state.state}"` }
  }

  const turn = state.promptAt ?? state.at ?? 0
  const interrupted = tailInterruptAt(state.transcript)

  if (interrupted > turn) {
    return {
      running: false,
      key: `interrupted-${interrupted}`,
      why: `interrupted ${ago(interrupted)}, turn began ${ago(turn)}`,
    }
  }

  const idle = Date.now() - (state.at ?? 0)

  if (idle >= config.workingTimeoutMs) {
    return { running: false, key: `timeout-${state.at}`, why: `no hook for ${(idle / 1000).toFixed(0)}s` }
  }

  return {
    running: true,
    key: `working-${turn}-${state.tool ?? ''}-${interrupted}`,
    why:
      `${state.tool ? `tool ${state.tool}` : 'no tool'}, turn began ${ago(turn)}` +
      (interrupted ? `, last interrupt ${ago(interrupted)} — OLDER than the turn` : ', no interrupt in the transcript'),
  }
}

const previous = new Map()
const sizes = new Map()

console.log(`\n  watching ${only ?? 'every session'} — press escape in Claude and see what moves\n`)

const look = () => {
  for (const id of sessions()) {
    const state = readState(id)
    const v = verdict(state)
    const short = id.slice(0, 8)

    // The transcript growing is the other half of the story: an interruption
    // that never reaches the file cannot be noticed however good the reading.
    let size = 0

    try {
      size = statSync(state?.transcript ?? '').size
    } catch {}

    const before = sizes.get(id) ?? size

    sizes.set(id, size)

    if (previous.get(id) !== v.key) {
      previous.set(id, v.key)
      console.log(`  ${clock()}  ${short}  ${v.running ? 'RUNNING' : 'still  '}  ${v.why}`)
    } else if (size !== before) {
      // The transcript moving without the verdict moving is the interesting
      // failure: Claude wrote something the reading did not react to.
      console.log(`  ${clock()}  ${short}  ${DIMMED}        transcript +${size - before}b, no change${RESET}`)
    }
  }
}

const DIMMED = '\x1b[2m'
const RESET = '\x1b[0m'

look()
setInterval(look, 250)
