// Opens the sprite window alongside a Claude session, once.
//
// macOS does not let Ghostty be driven from the command line — `+new-window`
// refuses outright — so a split cannot be scripted. What does work is asking
// macOS to launch another Ghostty with arguments, which gives a small window of
// its own running the sprite.
//
// Called from the SessionStart hook. Several Claude sessions may start at once,
// or one may be resumed repeatedly, so this has to be safe to call over and
// over: a pid file records the running window and a second call does nothing.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync as fileExists, readdirSync } from 'node:fs'
import { ROOT, STATE_DIR, loadConfig } from './config.mjs'
import { pickFor, requestedSpecies } from './roster.mjs'

// One sprite per session, so the pid is recorded per session too. A window
// belonging to one Claude must not be closed when a different one exits.
const safe = (id) => String(id ?? 'default').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64)

export const pidFileFor = (id) => join(STATE_DIR, `window-${safe(id)}.pid`)

// A pid file outlives a crash, so the number in it means nothing until the
// process is checked. Signal 0 asks the kernel whether it is alive without
// actually sending anything.
export const readPid = (id) => {
  const file = pidFileFor(id)

  if (!existsSync(file)) return null

  const pid = Number(readFileSync(file, 'utf8').trim())

  return Number.isInteger(pid) && pid > 0 ? pid : null
}

export const windowIsRunning = (id) => {
  const file = pidFileFor(id)

  if (!existsSync(file)) return false

  const pid = Number(readFileSync(file, 'utf8').trim())

  if (!Number.isInteger(pid) || pid <= 0) return false

  try {
    process.kill(pid, 0)

    return true
  } catch {
    try {
      unlinkSync(file)
    } catch {}

    return false
  }
}

// Closing is a signal to the sprite, not to the pane. The sprite exits, its
// shell was replaced by it via exec, and Ghostty closes the pane when its shell
// goes — so the whole strip disappears with the session that owned it.
export const closeWindow = (id) => {
  const pid = readPid(id)

  // The claim goes either way. A session that is ending has no use for its
  // Pokemon whether or not there was still a pane holding it.
  releaseSpecies(id)

  if (!pid) return false

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return false
  }

  try {
    unlinkSync(pidFileFor(id))
  } catch {}

  return true
}

// Ghostty can only be told to split by pressing the key that splits it. There
// is no command line route on macOS — `ghostty +new-window` answers "not
// supported on this platform" — so this drives the keyboard through System
// Events, the same way a macro would.
//
// It is the only way to get the sprite inside the Claude window rather than
// floating in one of its own, and the cost is that macOS must grant Ghostty
// permission to control the computer, and that the command is typed rather
// than passed, so the split has to have taken focus first.
// Every pane Ghostty opens gets its own login shell, so a new one appearing is
// proof the split exists — better than waiting a fixed period and hoping. A
// delay long enough to always be safe is long enough to be visible; this waits
// exactly as long as it needs to, and typing into the wrong pane stops being a
// question of timing.
const shellCount = () => {
  const probe = spawnSync('pgrep', ['-f', '^/usr/bin/login -flp'], { encoding: 'utf8' })

  return (probe.stdout ?? '').trim().split('\n').filter(Boolean).length
}

const waitForNewShell = (before, timeoutMs) => {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (shellCount() > before) return true

    // pgrep itself takes a few milliseconds, which is the whole poll interval.
    spawnSync('sleep', ['0.02'])
  }

  return false
}

const runScript = (body) => spawnSync('osascript', ['-e', body], { encoding: 'utf8' })

const openSplit = (rows, shrink, grow, id, species) => {
  // System Events types a keystroke string one character at a time, so the
  // length of this command is paid for in wall clock — the full node
  // invocation ran to 134 characters, close to a second of watching it appear.
  // Writing it to a script and typing the script's path instead is the same
  // command in a sixth of the keystrokes.
  const full =
    `exec ${process.execPath} ${join(ROOT, 'src', 'window.mjs')} ${rows} --session=${safe(id)}` +
    (species ? ` --species=${species}` : '')

  // Not tmpdir(): on macOS that is a forty character path under /var/folders,
  // and every character of it is another keystroke. /tmp is a symlink to the
  // same place and costs four.
  const launcher = `/tmp/pxr${safe(id).slice(0, 6)}`

  try {
    writeFileSync(launcher, `#!/bin/sh\n${full}\n`, { mode: 0o755 })
  } catch {
    // If the launcher cannot be written, typing the whole thing still works.
  }

  const command = existsSync(launcher) ? `exec ${launcher}` : full

  // One press of the big-step keybind pixel-runner adds to ~/.config/ghostty/
  // config, rather than a hundred presses of the built-in ten pixel one. The
  // built-in step is slow enough that you watch the pane crawl down; this is
  // instant.
  const squeeze = '        key code 125 using {command down, control down, shift down}'

  const before = shellCount()

  const split = runScript(`
    tell application "Ghostty" to activate
    delay 0.15
    tell application "System Events"
      keystroke "d" using {command down, shift down}
    end tell
  `)

  if (split.status !== 0) {
    const message = (split.stderr ?? '').trim()

    console.error(
      /not allowed|assistive|-1719|-25211/i.test(message)
        ? 'pixel-runner: macOS has not granted permission to control the computer.\n' +
            '  System Settings > Privacy & Security > Accessibility > enable Ghostty, then restart it.'
        : `pixel-runner: could not open the split — ${message}`,
    )

    return false
  }

  // If the shell never appears the split did not happen, and typing a command
  // now would send it to whatever is focused instead — most likely the Claude
  // prompt. Better to do nothing.
  if (!waitForNewShell(before, 2000)) {
    console.error('pixel-runner: the split did not open, so nothing was typed into it')

    return false
  }

  // Squash the empty pane, then start the sprite in it.
  const result = runScript(`
    tell application "System Events"
${squeeze}
      keystroke ${JSON.stringify(command)}
      key code 36
    end tell
  `)

  return result.status === 0
}

// Which Pokemon the panes that are already up have taken.
//
// Recorded here rather than by the pane, because the choice has to be made
// before the pane exists: opening one means launching a terminal and waiting
// for it to start, and two sessions beginning together would both look at an
// empty room and both pick Pikachu. Writing the claim at the moment of the
// decision is what makes the decision exclusive.
export const speciesFileFor = (id) => join(STATE_DIR, `window-${safe(id)}.species`)

// A claim that no pane ever arrived to back — the split failed, the terminal
// was killed while starting — would otherwise hold its Pokemon forever. So a
// claim counts while it is still young enough that its pane may yet appear, and
// after that only for as long as there is a live process behind it.
const STARTUP_GRACE_MS = 30_000

export const releaseSpecies = (id) => {
  try {
    unlinkSync(speciesFileFor(id))
  } catch {}
}

export const speciesInUse = (exceptId = null) => {
  const taken = new Set()

  if (!fileExists(STATE_DIR)) return taken

  for (const file of readdirSync(STATE_DIR)) {
    if (!file.endsWith('.species')) continue

    const id = file.slice('window-'.length, -'.species'.length)

    if (exceptId !== null && id === safe(exceptId)) continue

    const path = join(STATE_DIR, file)

    let species
    let claimedAt

    try {
      species = readFileSync(path, 'utf8').trim()
      claimedAt = statSync(path).mtimeMs
    } catch {
      continue
    }

    if (!species) continue

    if (windowIsRunning(id) || Date.now() - claimedAt < STARTUP_GRACE_MS) {
      taken.add(species)

      continue
    }

    // Nothing behind it and no longer new. Let the Pokemon go.
    try {
      unlinkSync(path)
    } catch {}
  }

  return taken
}

// A background agent is a session like any other and reports SessionStart like
// any other, but nobody is watching it: it has no terminal of its own. Giving
// it a pane is wrong twice over — a Pokemon for something you cannot see, and,
// in split mode, one that takes half of whichever Ghostty window happens to be
// focused, because a split is opened by pressing the key that splits it and the
// key lands wherever the focus is. Open the agents list and every agent in it
// cuts your terminal in half again.
//
// Claude Code keeps these under ~/.claude/jobs, one directory per agent, named
// with the first eight characters of its session id, written when the job is
// created — which is before the agent it describes has started, so it is
// already there by the time that agent's SessionStart arrives.
//
// `source` is what SessionStart says about itself. It is deliberately not
// judged here yet: a whitelist of the values seen so far would quietly stop
// opening panes at all the day Claude Code adds another one, and the directory
// alone identifies every agent observed. It is passed in and logged so the test
// can be tightened against real payloads rather than against a guess.
const JOBS_DIR = join(homedir(), '.claude', 'jobs')

export const isBackgroundAgent = (id, source = null) =>
  fileExists(join(JOBS_DIR, String(id ?? '').slice(0, 8)))

// Who this session gets, and the whole of that decision.
//
// Two rules, in this order, and the order is the point:
//
//   1. Asked for by name — `claude --ash` — you get that one. Always. Not if
//      it happens to be free, not unless something better is available: that
//      one. It outranks Pikachu-comes-first, it outranks Pikachu being free,
//      it outranks the Pokemon already being out in another window, and it
//      outranks randomPokemon being switched off altogether. Naming something
//      is not a preference to be weighed against other preferences.
//
//   2. Nothing asked for — the rotation. Pikachu whenever Pikachu is free,
//      otherwise one nobody else currently holds.
//
// Split out from openWindow so it can be tested, because openWindow's other
// half launches a terminal and cannot be run to find out what it would decide.
export const chooseSpecies = (id, config = loadConfig(), env = process.env) => {
  const asked = requestedSpecies(env)

  if (asked) return asked

  if (config.randomPokemon === false) return null

  return pickFor(id, speciesInUse(id))
}

export const openWindow = (id, source = null) => {
  const config = loadConfig()

  if (isBackgroundAgent(id, source)) return false

  if (windowIsRunning(id)) return false

  const rows = config.windowRows ?? 3
  const species = chooseSpecies(id, config)

  // Claimed before the terminal is launched, so a second session starting in
  // the same moment sees this one taken rather than an empty room.
  if (species) {
    try {
      mkdirSync(STATE_DIR, { recursive: true })
      writeFileSync(speciesFileFor(id), species)
    } catch {}
  }

  if (config.windowMode === 'split') return openSplit(rows, config.splitShrink ?? 120, config.splitGrow ?? 0, id, species)

  const args = [
    '-na',
    'Ghostty.app',
    '--args',
    // A window just tall enough for the sprite, and narrow. Ghostty sizes in
    // cells, which is what the sprite is measured in too.
    `--window-height=${rows + 1}`,
    `--window-width=${config.windowCols ?? 34}`,
    '--window-title=pikachu',
    '--window-decoration=false',
    '-e',
    process.execPath,
    join(ROOT, 'src', 'window.mjs'),
    String(rows),
    `--session=${safe(id)}`,
    ...(species ? [`--species=${species}`] : []),
  ]

  // Detached and with its streams released, so the hook can exit immediately
  // and the window is not tied to the lifetime of a hook that lives for
  // milliseconds.
  const child = spawn('open', args, { detached: true, stdio: 'ignore' })

  child.unref()

  return true
}

// Allow running it by hand: npm run companion
if (process.argv[1] && process.argv[1].endsWith('companion.mjs')) {
  const id = process.argv[2] ?? 'manual'

  console.log(openWindow(id) ? `opened the sprite window for ${id}` : 'already running')
}
