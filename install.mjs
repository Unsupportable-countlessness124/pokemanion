// Registers the hooks with every coding agent you have, and takes them back
// out again with --uninstall.
//
// Claude Code and Codex both run command hooks, with the same event names and
// the same JSON on stdin, so the same handler serves both — see src/agents.mjs.
// They differ only in where the registration lives:
//
//   Claude   ~/.claude/settings.json    hooks are one key among many
//   Codex    ~/.codex/hooks.json        the whole file is hooks
//
// Both take the same `{ hooks: { Event: [{ hooks: [{ type, command }] }] } }`
// shape underneath, which is why this is one loop rather than two installers.
//
// Our entries are recognised by the command they run — our launcher plus one of
// our scripts — so uninstalling only removes what we added and leaves anything
// else in the file alone.
//
// Usage: node install.mjs [--claude|--codex] [--uninstall] [--no-verbs]

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ROOT } from './src/config.mjs'
import { AGENTS, chosen, eventsFor, isStale } from './src/agents.mjs'

const RUNNER = `"${join(ROOT, 'bin', 'run.sh')}"`
const ACTIVITY_COMMAND = `${RUNNER} on-activity.mjs`

// Replacing the verbs entirely keeps the spinner line on theme with the sprite.
// Claude Code picks one per turn, so these do not animate — they just stop the
// sprite sitting under an unrelated word. Claude-only: Codex has no equivalent.
const SPINNER_VERBS = {
  mode: 'replace',
  verbs: [
    'Battling',
    'Charging',
    'Evolving',
    'Sprinting',
    'Thundershocking',
    'Quick-attacking',
    'Scampering',
    'Bolting',
    'Dashing',
    'Zapping',
  ],
}

const uninstalling = process.argv.includes('--uninstall')
const skipVerbs = process.argv.includes('--no-verbs')

// Ours are recognised by the shape of the command we write: our launcher, then
// one of our scripts.
//
// This used to look for the literal string `pixel-runner`, which is this
// project's old name and, by coincidence, the folder it was developed in. It
// matched on exactly one machine. Anyone who cloned the repo got a folder
// called `pokemanion`, so nothing they had installed was ever recognised as
// ours: re-running the installer stacked a second full set of hooks instead of
// replacing the first, and `--uninstall` removed nothing while printing that it
// had. CI found it because its checkout is not named after the old project.
//
// Both halves are required. `run.sh` alone would be too broad, and a script
// name alone would match a hook someone else happened to name the same.
const OUR_SCRIPTS = ['on-activity.mjs', 'statusline.mjs']

const isOurCommand = (command) => {
  const text = String(command ?? '')

  return text.includes('run.sh') && OUR_SCRIPTS.some((script) => text.includes(script))
}

const isOurs = (group) => (group?.hooks ?? []).some((hook) => isOurCommand(hook?.command))

const withoutOurs = (groups) => (groups ?? []).filter((group) => !isOurs(group))

// Which node this is, so the hooks can find one later.
//
// bin/run.sh has to locate an interpreter from inside a hook, where the PATH is
// trimmed and none of the usual guesses need be true — under nvm, node lives in
// a version-numbered directory that moves every upgrade. Recording the
// interpreter that ran this installer is the only path that is certainly right,
// because it just proved itself by running.
try {
  mkdirSync(join(ROOT, '.state'), { recursive: true })
  writeFileSync(join(ROOT, '.state', 'node-path'), `${process.execPath}\n`)
} catch {}

const read = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    // Missing is ordinary. Corrupt is not worth failing over either — the
    // alternative is refusing to install because something else wrote bad JSON,
    // and the backup below means the original is still recoverable.
    return {}
  }
}

const write = (file, document) => {
  // The directory may not exist yet. Writing straight into it threw ENOENT with
  // a node stack trace and — because this runs at the top level of a script that
  // ends `process.exit(0)` — still exited 0, so `npm run setup` reported the
  // step as done having written nothing at all.
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`)
}

const targets = chosen()

if (targets.length === 0) {
  const stale = AGENTS.filter(isStale)

  console.error('  no coding agent found — install Claude Code or Codex first')

  // The state that makes a directory check look like a working detector: the
  // config folder is there from some earlier life, the program is not.
  for (const agent of stale) {
    console.error(`  (${agent.dir()} exists, but there is no ${agent.name} on your PATH)`)
  }

  process.exit(1)
}

for (const agent of targets) {
  const file = agent.file()
  const backup = `${file}.pixel-runner-backup`
  const events = eventsFor(agent)
  const document = read(file)

  if (existsSync(file) && !existsSync(backup)) {
    copyFileSync(file, backup)
    console.log(`  ${agent.name}: backed up to ${backup}`)
  }

  if (uninstalling) {
    // Claude's status line lives beside the hooks in the same file. Codex has
    // no such key, so this simply never matches there.
    if (isOurCommand(document.statusLine?.command)) delete document.statusLine

    for (const event of events) {
      if (!document.hooks?.[event]) continue

      const kept = withoutOurs(document.hooks[event])

      if (kept.length) document.hooks[event] = kept
      else delete document.hooks[event]
    }

    if (document.hooks && Object.keys(document.hooks).length === 0) delete document.hooks

    if (JSON.stringify(document.spinnerVerbs) === JSON.stringify(SPINNER_VERBS)) delete document.spinnerVerbs

    write(file, document)
    console.log(`  ${agent.name}: removed from ${file}`)

    continue
  }

  // No status line. The sprite lives in its own pane now, and interruptions are
  // caught from the transcript rather than from a status line heartbeat — so
  // there is nothing left for it to do, and leaving one installed would only
  // suppress the agent's own footer hints.
  if (isOurCommand(document.statusLine?.command)) delete document.statusLine

  document.hooks = document.hooks ?? {}

  for (const event of events) {
    document.hooks[event] = [
      ...withoutOurs(document.hooks[event]),
      { hooks: [{ type: 'command', command: ACTIVITY_COMMAND, timeout: 5 }] },
    ]
  }

  // Claude-only, and only when it is the whole file we are writing. Codex has
  // no spinner to theme, and putting an unknown key in its hooks file would be
  // rude at best.
  if (!skipVerbs && agent.shape === 'settings') document.spinnerVerbs = SPINNER_VERBS

  write(file, document)
  console.log(`  ${agent.name}: ${events.length} hooks -> ${file}`)
}

console.log(
  uninstalling
    ? `\n  Done. Restart ${targets.map((agent) => agent.label).join(' and ')}.\n`
    : `\n  Done. Restart ${targets.map((agent) => agent.label).join(' and ')} to load the hooks.` +
        `\n  Undo with: node ${join(ROOT, 'install.mjs')} --uninstall\n`,
)
