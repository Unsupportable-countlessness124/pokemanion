// Checks that every part of the setup is actually in place.
//
// There are a lot of moving pieces — settings.json wiring, hooks, sprites, an
// external renderer, a terminal that can draw the glyphs, a macOS permission —
// and most of them fail quietly. This says which.

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { decodeGif } from './gif.mjs'
import { decodeSprite } from './png.mjs'
import { prepare } from './prepare.mjs'
import { sharedBounds } from './render.mjs'
import { FRAMES_FILE, ROOT, loadConfig } from './config.mjs'
import { speciesInUse, windowIsRunning } from './companion.mjs'
import { available, fetchedGuests, knownCount, pickFor } from './roster.mjs'
import { guestCost } from './prune.mjs'

const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const DIM = '\x1b[2m'
const RESET = '\x1b[0m'

const results = []

const check = (name, fn) => {
  try {
    const { ok, detail, warn } = fn()

    results.push({ name, ok, warn, detail })
  } catch (error) {
    results.push({ name, ok: false, detail: error.message })
  }
}

const config = loadConfig()

check('config readable', () => ({ ok: true, detail: `${Object.keys(config).length} settings` }))

check('status line sprite', () => ({
  ok: true,
  warn: !config.statusSprite,
  detail: config.statusSprite ? `on, ${config.rows} rows, style ${config.style}` : 'off — text only',
}))

check('built frames', () => {
  if (!existsSync(FRAMES_FILE)) return { ok: false, detail: 'missing — run npm run build' }

  const bundle = JSON.parse(readFileSync(FRAMES_FILE, 'utf8'))

  return {
    ok: true,
    warn: bundle.sprite !== config.sprite,
    detail:
      bundle.sprite === config.sprite
        ? `${bundle.frames.length} frames, ${bundle.cols}x${bundle.rows} cells`
        : `built from ${bundle.sprite} but config says ${config.sprite} — run npm run build`,
  }
})

for (const [label, name] of [
  ['working sprite', config.windowSprite ?? config.sprite],
  ['idle sprite', config.windowIdleSprite ?? config.windowSprite ?? config.sprite],
]) {
  check(label, () => {
    const path = isAbsolute(name) ? name : join(ROOT, name)

    if (!existsSync(path)) return { ok: false, detail: `${name} not found` }

    const raw = readFileSync(path)
    const image = prepare(decodeSprite(raw) ?? decodeGif(raw), config.bounce, config.sheetFrames)
    const box = sharedBounds(image.frames, image.width, image.height)

    return {
      ok: image.frames.length > 0,
      detail: `${name} — ${box.width}x${box.height}, ${image.frames.length} frames`,
    }
  })
}

check('chafa', () => {
  const probe = spawnSync('chafa', ['--version'], { encoding: 'utf8' })

  return {
    ok: probe.status === 0,
    detail: probe.status === 0 ? probe.stdout.split('\n')[0] : 'not installed — brew install chafa',
  }
})

check('Ghostty', () => ({
  ok: existsSync('/Applications/Ghostty.app'),
  detail: existsSync('/Applications/Ghostty.app') ? 'installed' : 'not installed',
}))

check('Claude settings wiring', () => {
  const file = join(homedir(), '.claude', 'settings.json')

  if (!existsSync(file)) return { ok: false, detail: 'no ~/.claude/settings.json' }

  const settings = JSON.parse(readFileSync(file, 'utf8'))
  const statusLine = String(settings.statusLine?.command ?? '')
  const events = Object.entries(settings.hooks ?? {})
    .filter(([, groups]) =>
      groups.some((group) => (group.hooks ?? []).some((hook) => String(hook.command).includes('pixel-runner'))),
    )
    .map(([event]) => event)

  const needed = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Stop']
  const missing = needed.filter((event) => !events.includes(event))

  return {
    ok: missing.length === 0,
    detail: missing.length
      ? `hooks missing: ${missing.join(', ')} — run npm run install-statusline`
      : `${events.length} hooks registered${statusLine.includes('pixel-runner') ? ', status line wired' : ''}`,
  }
})

check('sprite window', () => {
  const sizeFile = join(ROOT, '.state', 'window.size')
  const measured = existsSync(sizeFile) ? readFileSync(sizeFile, 'utf8').trim() : null

  return {
    ok: true,
    detail:
      (windowIsRunning() ? 'running' : 'not running') +
      (measured ? `, pane last measured ${measured}` : ''),
  }
})

// The frame cache is keyed by row count, so a cache warmed for a height the
// pane never settles on is no cache at all: every sprite is rendered from
// scratch the first time it is shown, which is two seconds of frozen animation
// rather than three hundredths. It costs nothing when it is right and is
// invisible when it is wrong, so it is worth stating plainly.
check('cache matches the pane', () => {
  const sizeFile = join(ROOT, '.state', 'window.size')

  if (!existsSync(sizeFile)) return { ok: true, warn: true, detail: 'no pane measured yet — open one, then npm run warm' }

  const measured = readFileSync(sizeFile, 'utf8').trim()
  const paneRows = Number(measured.match(/x(\d+)/)?.[1] ?? 0)

  if (!paneRows) return { ok: true, warn: true, detail: `unreadable size "${measured}"` }

  const cacheDir = join(ROOT, '.state', 'cache')

  if (!existsSync(cacheDir)) return { ok: false, detail: 'no cache — run npm run warm' }

  // Counted, not just checked for presence. One sprite left at the right height
  // by an unrelated run would otherwise pass this while every other Pokemon
  // still stalls for two seconds on its first appearance.
  const byRows = new Map()

  for (const file of readdirSync(cacheDir)) {
    if (!file.endsWith('.json')) continue

    try {
      const { rows } = JSON.parse(readFileSync(join(cacheDir, file), 'utf8'))

      byRows.set(rows, (byRows.get(rows) ?? 0) + 1)
    } catch {}
  }

  // Two sprites each — one for waiting, one for working.
  const wanted = available().length * 2
  const got = byRows.get(paneRows) ?? 0

  if (got >= wanted) return { ok: true, detail: `all ${available().length} warmed for ${paneRows} rows` }

  const others = [...byRows.entries()]
    .filter(([rows]) => rows !== paneRows)
    .map(([rows, n]) => `${n} at ${rows}`)
    .join(', ')

  return {
    ok: false,
    detail:
      `pane is ${paneRows} rows but only ${got} of ${wanted} sprites are warmed for it` +
      `${others ? ` (${others})` : ''} — run: npm run warm -- ${paneRows}`,
  }
})

// Guests are the ones not in the roster: fetched when summoned, evicted when
// the space is wanted. Worth showing because the disk they use is invisible
// otherwise, and because it is the number that decides when they start leaving.
check('guest Pokemon', () => {
  const guests = fetchedGuests()
  const budget = (config.guestBudgetMb ?? 200) * 1024 * 1024
  const used = guests.reduce((total, name) => total + guestCost(name), 0)
  const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)}MB`

  return {
    ok: true,
    detail: guests.length
      ? `${guests.length} of ${knownCount()} fetched — ${mb(used)} of ${mb(budget)}: ${guests.slice(0, 6).join(', ')}${guests.length > 6 ? '...' : ''}`
      : `none fetched — ${knownCount()} available on request`,
  }
})

// Which Pokemon are spoken for, and what the next terminal would therefore be
// given. Pikachu goes to whoever is free to have it, so the useful thing to see
// is whether anything is holding it.
check('Pokemon in use', () => {
  const taken = speciesInUse()
  const next = pickFor('the-next-session', taken)

  return {
    ok: true,
    detail: `${taken.size ? [...taken].sort().join(', ') : 'none'} — next terminal gets ${next ?? 'nothing, no sprites fetched'}`,
  }
})

check('auto-open', () => {
  if (!config.autoWindow) return { ok: true, warn: true, detail: 'off — start it with npm run window' }

  if (config.windowMode !== 'split') return { ok: true, detail: 'on, separate window (no permission needed)' }

  // The permission belongs to whichever app runs the script, so this can only
  // report what it sees from here.
  const probe = spawnSync(
    'osascript',
    ['-e', 'tell application "System Events" to return count of processes'],
    { encoding: 'utf8' },
  )

  const allowed = probe.status === 0

  return {
    ok: true,
    warn: !allowed,
    detail: allowed
      ? 'on, split mode, accessibility granted here'
      : 'on, split mode — accessibility NOT granted to this terminal.\n' +
        '      System Settings > Privacy & Security > Accessibility > enable Ghostty,\n' +
        '      then restart Ghostty. Or set windowMode to "window" to skip permissions.',
  }
})

console.log(`\n  ${DIM}pixel-runner${RESET}\n`)

for (const { name, ok, warn, detail } of results) {
  const mark = !ok ? `${RED}✘${RESET}` : warn ? `${YELLOW}•${RESET}` : `${GREEN}✔${RESET}`

  console.log(`  ${mark} ${name.padEnd(22)} ${DIM}${detail}${RESET}`)
}

const broken = results.filter((r) => !r.ok).length
const warned = results.filter((r) => r.ok && r.warn).length

console.log(
  `\n  ${broken ? `${RED}${broken} broken${RESET}, ` : ''}${warned ? `${YELLOW}${warned} to look at${RESET}, ` : ''}` +
    `${results.length - broken - warned} fine\n`,
)

process.exitCode = broken ? 1 : 0
