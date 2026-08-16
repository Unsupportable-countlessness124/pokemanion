// Telling you a new version exists, and never installing it.
//
// Both install routes update with one command, and neither does it on its own.
// The gap that leaves is not the command — it is that nobody knows there is
// anything to run. So this checks, at most once a day, in a process that has
// already been let go of, and says so once per version.
//
// It deliberately stops there. Auto-updating a clone means running `git pull`
// inside someone's repository from a hook, which fails badly the moment they
// have edits of their own — and people are expected to have edits, since that is
// the whole reason to clone rather than install the plugin. Auto-updating a
// plugin means invoking the agent's own CLI from inside that agent's hook. Both
// trade a mild annoyance for a rare disaster.

import { spawn } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, STATE_DIR } from './config.mjs'
import { isPluginRoot } from './shell.mjs'

const LATEST = join(STATE_DIR, 'latest-version')
const ANNOUNCED = join(STATE_DIR, 'announced-version')
const DAY = 24 * 60 * 60 * 1000

const SOURCE = 'https://raw.githubusercontent.com/khatriadbhut/pokemanion/main/package.json'

export const installedVersion = () => {
  try {
    return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version ?? null
  } catch {
    return null
  }
}

// 1.10.0 is newer than 1.9.0, which string comparison gets backwards — the same
// trap the plugin path resolver has, and worth the six lines to avoid twice.
export const isNewer = (candidate, current) => {
  const parts = (text) => String(text ?? '').split('.').map((piece) => Number.parseInt(piece, 10) || 0)
  const [a, b] = [parts(candidate), parts(current)]

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }

  return false
}

const stamp = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

// Detached, disowned, and given five seconds. The hook that starts this has
// exited long before curl answers, which is the point: a version check must
// never be a reason a prompt is slow, and offline must cost nothing at all.
export const checkInBackground = (now = Date.now()) => {
  const last = stamp(LATEST)

  if (last && now - (last.at ?? 0) < DAY) return 'checked recently'

  try {
    mkdirSync(STATE_DIR, { recursive: true })

    // Written by the child rather than parsed here, so nothing waits on it.
    const script =
      `v=$(curl -fsS -m 5 ${JSON.stringify(SOURCE)} 2>/dev/null | ` +
      `sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' | head -1); ` +
      `[ -n "$v" ] && printf '{"at":%s,"version":"%s"}' "${now}" "$v" > ${JSON.stringify(LATEST)}`

    const child = spawn('sh', ['-c', script], { detached: true, stdio: 'ignore' })

    child.unref()

    return 'started'
  } catch {
    return 'failed'
  }
}

// What to run, which depends on how it was installed — and telling a plugin user
// to `git pull` is how a helpful message becomes a confusing one.
export const updateCommand = (root = ROOT) => {
  if (!isPluginRoot(root)) return `cd ${root} && git pull && npm run setup`

  return root.includes('.codex')
    ? 'codex plugin marketplace upgrade && codex plugin add pokemanion@pokemanion'
    : '/plugin update pokemanion@pokemanion'
}

// A version worth mentioning: newer than this one, and not already mentioned.
export const pendingUpdate = () => {
  const current = installedVersion()
  const latest = stamp(LATEST)?.version

  if (!current || !latest || !isNewer(latest, current)) return null

  if (stamp(ANNOUNCED)?.version === latest) return null

  return { current, latest, command: updateCommand() }
}

export const markAnnounced = (version) => {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(ANNOUNCED, JSON.stringify({ version }))
  } catch {}
}

export const notice = ({ current, latest, command }) =>
  `pokemanion ${latest} is out — you have ${current}.\n\n  ${command}\n\n` +
  `${isPluginRoot() ? 'Restart the agent afterwards.\n' : ''}` +
  'Nothing breaks if you stay on this one; you would just miss whatever is new.\n' +
  'Turn these off with "updateCheck": false in config.json.\n'

// Reading it by hand: npm run update-check
if (process.argv[1] && process.argv[1].endsWith('update.mjs')) {
  console.log(`\n  installed: ${installedVersion()}`)
  console.log(`  latest seen: ${stamp(LATEST)?.version ?? 'not checked yet'}`)
  console.log(`  check: ${checkInBackground(Date.now())}`)
  console.log(`  update with: ${updateCommand()}\n`)
}
