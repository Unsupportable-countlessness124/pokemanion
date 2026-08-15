// The status line. Prints the sprite on the left and session info beside it.
//
// Claude Code re-runs this on a one second timer and again whenever a message
// updates, so the frame is derived from the clock rather than from a counter:
// however often we happen to be called, the animation runs at the same speed.

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { FRAMES_FILE, loadConfig, readState } from '../src/config.mjs'
import { tailInterruptAt } from '../src/interrupt.mjs'

const DIM = '\x1b[2m'
const RESET = '\x1b[0m'
const BOLD = '\x1b[1m'
const YELLOW = '\x1b[38;2;247;208;44m'

const config = loadConfig()

const readStdin = () => {
  try {
    return JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    return {}
  }
}

const loadFrames = () => {
  try {
    return JSON.parse(readFileSync(FRAMES_FILE, 'utf8'))
  } catch {
    return null
  }
}

const isWorking = (state) => {
  if (state?.state !== 'working') return false

  // Pressing escape fires no hook, so the state file still says "working".
  // Compared against the start of the turn rather than the last hook: a tool
  // interrupted mid-run still reports its PostToolUse afterwards, which would
  // otherwise look newer than the interruption.
  if (tailInterruptAt(state.transcript) > (state.promptAt ?? state.at ?? 0)) return false

  return Date.now() - (state.at ?? 0) < config.workingTimeoutMs
}

// Frame from wall clock, so the phase is continuous across separate runs.
const frameFor = (frames, working) => {
  if (!working && !config.animateWhenIdle) return frames[0]

  return frames[Math.floor(Date.now() / config.frameMs) % frames.length]
}

const bar = (percent, width = 10) => {
  const filled = Math.max(0, Math.min(width, Math.round((percent / 100) * width)))

  return `${'█'.repeat(filled)}${DIM}${'░'.repeat(width - filled)}${RESET}`
}

const session = readStdin()

// What Claude Code actually sends, appended verbatim. The payload is the only
// live measurement of whether Claude is still doing anything, so it is worth
// being able to see it rather than reasoning about the documentation.
if (config.logPayloads) {
  try {
    const { appendFileSync, mkdirSync } = await import('node:fs')
    const { STATE_DIR } = await import('../src/config.mjs')

    mkdirSync(STATE_DIR, { recursive: true })
    appendFileSync(`${STATE_DIR}/payloads.jsonl`, `${JSON.stringify({ at: Date.now(), ...session })}\n`)
  } catch {}
}

// The status line runs about once a second with real session data, which makes
// it the only thing in this project that can see whether Claude is actually
// producing anything. Recorded so an idle detector can be built on what the
// payload really contains rather than on what the docs imply.
const model = session?.model?.display_name ?? 'Claude'
const dir = session?.workspace?.current_dir ?? process.cwd()
const percent = Math.round(session?.context_window?.used_percentage ?? 0)

// Whether this session is busy, from the state its own hooks wrote. Keyed by
// session id so a second Claude in another window cannot set this one running.
const state = readState(session?.session_id)
const working = isWorking(state)

const verb = working
  ? `${YELLOW}${state?.tool ? `using ${state.tool}` : 'running'}…${RESET}`
  : `${DIM}resting${RESET}`

// One info line per sprite row, vertically centred against the sprite.
const info = [
  `${BOLD}${model}${RESET}  ${DIM}·${RESET}  ${basename(dir)}`,
  `${bar(percent)} ${percent}%  ${DIM}context${RESET}`,
  verb,
]

// With the sprite running in a pane of its own there is nothing for it to do
// here, and the status line is just text again.
if (!config.statusSprite) {
  for (const line of info) console.log(line)

  process.exit(0)
}

const bundle = loadFrames()

if (!bundle) {
  console.log(`${DIM}pixel-runner: no frames built — run \`npm run build\`${RESET}`)
  process.exit(0)
}

const rows = frameFor(bundle.frames, working)

const top = Math.max(0, Math.floor((rows.length - info.length) / 2))
const gap = '  '

rows.forEach((row, index) => {
  const line = info[index - top]

  console.log(`${row}${gap}${line ?? ''}`)
})
