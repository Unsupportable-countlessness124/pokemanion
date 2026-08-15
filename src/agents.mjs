// The coding agents this can attach itself to, and how to tell which you have.
//
// Claude Code and Codex have near-identical hook systems — same event names,
// same JSON on stdin, same field names, same "exit 2 and write to stderr to
// block a prompt". That is why `bin/on-activity.mjs` needed no changes at all
// to serve both: it reads `hook_event_name`, `session_id` and `prompt`, and
// both supply exactly those.
//
// What differs is only where the registration goes, and one event's name.
//
// Detection is on the binary, not the config directory. A directory proves
// somebody once ran something; the binary proves you can run it now. The
// machine this was written on has a ~/.codex directory and no codex installed,
// which would have produced hooks pointing at a program that is not there.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

// Claude calls it Notification, Codex calls it PermissionRequest. Both mean the
// same thing to us — the agent is waiting on you rather than working — and
// on-activity.mjs treats them identically.
export const HOOK_EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'SessionStart', 'SessionEnd']

export const AGENTS = [
  {
    name: 'claude',
    label: 'Claude Code',
    // Merged into a settings file that holds much more than hooks, so its own
    // entries have to be picked back out by hand on uninstall.
    file: () => join(homedir(), '.claude', 'settings.json'),
    shape: 'settings',
    waiting: 'Notification',
    dir: () => join(homedir(), '.claude'),
  },
  {
    name: 'codex',
    label: 'Codex',
    // A file of its own, whose entire contents are hooks.
    file: () => join(homedir(), '.codex', 'hooks.json'),
    shape: 'hooks-file',
    waiting: 'PermissionRequest',
    dir: () => join(homedir(), '.codex'),
  },
]

export const eventsFor = (agent) => [...HOOK_EVENTS, agent.waiting]

const onPath = (binary) => spawnSync('command', ['-v', binary], { shell: true, encoding: 'utf8' }).status === 0

export const isInstalled = (agent) => onPath(agent.name)

// Has a config directory but no binary — worth saying out loud, because it is
// the state that makes a directory check look like a working detector.
export const isStale = (agent) => !isInstalled(agent) && existsSync(agent.dir())

export const detected = () => AGENTS.filter(isInstalled)

// `--claude` / `--codex` force a choice. Without one, whatever is installed.
export const chosen = (argv = process.argv) => {
  const asked = AGENTS.filter((agent) => argv.includes(`--${agent.name}`))

  return asked.length > 0 ? asked : detected()
}

export const byName = (name) => AGENTS.find((agent) => agent.name === name) ?? null
