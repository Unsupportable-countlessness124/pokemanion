// Wires the status line and the hooks into ~/.claude/settings.json, and takes
// them back out again with --uninstall.
//
// Our entries are recognised by the path they run, so uninstalling only removes
// what we added and leaves anything else in the file alone.

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { FRAMES_FILE, ROOT } from './src/config.mjs'

const SETTINGS = join(homedir(), '.claude', 'settings.json')
const BACKUP = `${SETTINGS}.pixel-runner-backup`

const RUNNER = `"${join(ROOT, 'bin', 'run.sh')}"`
const STATUS_COMMAND = `${RUNNER} statusline.mjs`
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
  writeFileSync(SETTINGS, `${JSON.stringify(document, null, 2)}\n`)
}

const isOurs = (group) =>
  (group?.hooks ?? []).some((hook) => String(hook?.command ?? '').includes('pixel-runner'))

const withoutOurs = (groups) => (groups ?? []).filter((group) => !isOurs(group))

const settings = read()

if (existsSync(SETTINGS) && !existsSync(BACKUP)) {
  copyFileSync(SETTINGS, BACKUP)
  console.log(`  backed up your settings to ${BACKUP}`)
}

if (uninstalling) {
  if (String(settings.statusLine?.command ?? '').includes('pixel-runner')) {
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

if (!existsSync(FRAMES_FILE)) {
  console.error('  no frames built yet — run `npm run build` first')
  process.exit(1)
}

// No status line. The sprite lives in its own pane now, and interruptions are
// caught from the transcript rather than from a status line heartbeat — so
// there is nothing left for it to do, and leaving one installed would only
// suppress Claude Code's own footer hints.
if (String(settings.statusLine?.command ?? '').includes('pixel-runner')) {
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

console.log(`  status line  -> ${STATUS_COMMAND}`)
console.log(`  hooks        -> ${HOOK_EVENTS.join(', ')}`)
console.log(`  spinner verbs-> ${skipVerbs ? 'left alone' : `${SPINNER_VERBS.verbs.length} themed verbs`}`)
console.log('\n  Done. Restart Claude Code to load the hooks and the status line.')
console.log(`  Undo with: node ${join(ROOT, 'install.mjs')} --uninstall\n`)
