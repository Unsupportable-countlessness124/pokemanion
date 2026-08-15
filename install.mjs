// Wires the status line and the hooks into ~/.claude/settings.json, and takes
// them back out again with --uninstall.
//
// Our entries are recognised by the command they run — our launcher plus one of
// our scripts — so uninstalling only removes what we added and leaves anything
// else in the file alone.

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { ROOT } from './src/config.mjs'

const SETTINGS = join(homedir(), '.claude', 'settings.json')
const BACKUP = `${SETTINGS}.pixel-runner-backup`

const RUNNER = `"${join(ROOT, 'bin', 'run.sh')}"`
const ACTIVITY_COMMAND = `${RUNNER} on-activity.mjs`

// Notification is here for the turns that end by Claude asking you something
// rather than by finishing. PreToolUse has already said "working" and no
// PostToolUse is ever coming, so without this the sprite runs for as long as
// the question sits unanswered.
const HOOK_EVENTS = [
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'Stop',
  'SessionStart',
  'SessionEnd',
]

// Replacing the verbs entirely keeps the spinner line on theme with the sprite.
// Claude Code picks one per turn, so these do not animate — they just stop the
// sprite sitting under an unrelated word.
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

const read = () => {
  try {
    return JSON.parse(readFileSync(SETTINGS, 'utf8'))
  } catch {
    return {}
  }
}

const write = (document) => {
  // ~/.claude may not exist yet. Writing straight into it threw ENOENT with a
  // node stack trace and — because this runs at the top level of a script that
  // ends `process.exit(0)` — still exited 0, so `npm run setup` reported the
  // step as done having written nothing at all.
  mkdirSync(dirname(SETTINGS), { recursive: true })
  writeFileSync(SETTINGS, `${JSON.stringify(document, null, 2)}\n`)
}

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

const settings = read()

if (existsSync(SETTINGS) && !existsSync(BACKUP)) {
  copyFileSync(SETTINGS, BACKUP)
  console.log(`  backed up your settings to ${BACKUP}`)
}

if (uninstalling) {
  if (isOurCommand(settings.statusLine?.command)) {
    delete settings.statusLine
    console.log('  removed the status line')
  } else {
    console.log('  status line was not ours, left alone')
  }

  for (const event of HOOK_EVENTS) {
    if (!settings.hooks?.[event]) continue

    const kept = withoutOurs(settings.hooks[event])

    if (kept.length) settings.hooks[event] = kept
    else delete settings.hooks[event]
  }

  if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks

  if (JSON.stringify(settings.spinnerVerbs) === JSON.stringify(SPINNER_VERBS)) {
    delete settings.spinnerVerbs
    console.log('  restored the default spinner verbs')
  }

  write(settings)
  console.log('\n  Done. Restart Claude Code.\n')
  process.exit(0)
}

// There used to be a guard here refusing to install until `npm run build` had
// written build/frames.json. Those frames are read by exactly one file,
// bin/statusline.mjs, and the status line is no longer installed — the block
// below removes it if it finds one. So the guard was demanding a build for a
// feature this script switches off four lines later.
//
// It made a fresh clone impossible to install. `npm run setup` reported the
// first two steps done and stopped at the third with "run npm run build first",
// and the four commands the README listed before that had the same hole. It
// only ever worked on a machine that had run the build back when the status
// line was the whole project.

// No status line. The sprite lives in its own pane now, and interruptions are
// caught from the transcript rather than from a status line heartbeat — so
// there is nothing left for it to do, and leaving one installed would only
// suppress Claude Code's own footer hints.
if (isOurCommand(settings.statusLine?.command)) {
  delete settings.statusLine
}

settings.hooks = settings.hooks ?? {}

for (const event of HOOK_EVENTS) {
  settings.hooks[event] = [
    ...withoutOurs(settings.hooks[event]),
    { hooks: [{ type: 'command', command: ACTIVITY_COMMAND, timeout: 5 }] },
  ]
}

if (!skipVerbs) settings.spinnerVerbs = SPINNER_VERBS

write(settings)

console.log(`  hooks        -> ${HOOK_EVENTS.join(', ')}`)
console.log(`  spinner verbs-> ${skipVerbs ? 'left alone' : `${SPINNER_VERBS.verbs.length} themed verbs`}`)
console.log('\n  Done. Restart Claude Code to load the hooks.')
console.log(`  Undo with: node ${join(ROOT, 'install.mjs')} --uninstall\n`)
