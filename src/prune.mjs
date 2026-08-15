// Throwing guests out.
//
// Residents — the roster — are pinned: hand-tuned, always on disk, pre-rendered
// so a session starts instantly. Guests are every other Pokemon the sprite
// folder has, fetched the first time they are asked for. There are over twelve
// hundred of them, and keeping them all would cost about 2.7GB of frame cache,
// so they have to leave when the space is wanted.
//
// Least recently shown goes first, which is the only ordering that matches how
// they are actually used: a Pokemon summoned once out of curiosity should go
// before one summoned every day.
//
// Two things get deleted per guest, and both matter. The sprites are small; the
// rendered frames are not — one Pokemon is about 3MB of escape sequences at a
// four-row pane, which is where all the weight is.
//
// Usage: npm run prune [-- --dry]

import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { CACHE_VERSION, ROOT, STATE_DIR, loadConfig } from './config.mjs'
import { POKEMON_DIR, busyFile, forget, guestsByAge, idleFile, isGuest } from './roster.mjs'

const CACHE_DIR = join(STATE_DIR, 'cache')

const sizeOf = (path) => {
  try {
    const stat = statSync(path)

    if (!stat.isDirectory()) return stat.size

    return readdirSync(path).reduce((total, child) => total + sizeOf(join(path, child)), 0)
  } catch {
    return 0
  }
}

// Which cache entries belong to which sprite file. The cache is keyed by a hash
// of the file path and its size, so the mapping is not recoverable from the
// name — every entry records the sprite it was rendered from instead.
const cacheBySprite = () => {
  const map = new Map()

  if (!existsSync(CACHE_DIR)) return map

  for (const file of readdirSync(CACHE_DIR)) {
    if (!file.endsWith('.json')) continue

    const path = join(CACHE_DIR, file)

    let entry

    try {
      entry = JSON.parse(readFileSync(path, 'utf8'))
    } catch {
      continue
    }

    // Written by an older version of the renderer, so its key can never be
    // computed again and it can never be hit. Marked with a name nothing owns,
    // which puts it straight in the orphan sweep below.
    const from = entry.v === CACHE_VERSION ? entry.name : '\u0000stale'

    if (!from) continue

    if (!map.has(from)) map.set(from, [])

    map.get(from).push(path)
  }

  return map
}

export const guestCost = (name) => {
  const cache = cacheBySprite()
  const files = [idleFile(name), busyFile(name)].flatMap((sprite) => cache.get(sprite) ?? [])

  return sizeOf(join(POKEMON_DIR, name)) + files.reduce((total, file) => total + sizeOf(file), 0)
}

// Cache entries whose sprite no longer exists can never be hit again. They are
// swept whether or not anything is being evicted, because a roster edit orphans
// them too — the 42MB left behind by one such change is what prompted this.
export const sweepOrphans = (dry = false) => {
  let freed = 0
  let count = 0

  for (const [sprite, files] of cacheBySprite()) {
    const path = sprite.startsWith('/') ? sprite : join(ROOT, sprite)

    if (existsSync(path)) continue

    for (const file of files) {
      freed += sizeOf(file)
      count++

      if (!dry) {
        try {
          rmSync(file)
        } catch {}
      }
    }
  }

  return { count, freed }
}

export const prune = ({ dry = false, budgetMb, keepDays } = {}) => {
  const config = loadConfig()
  const budget = (budgetMb ?? config.guestBudgetMb ?? 200) * 1024 * 1024
  const keepMs = (keepDays ?? config.guestKeepDays ?? 14) * 24 * 60 * 60 * 1000

  const orphans = sweepOrphans(dry)

  const used = (() => {
    try {
      return JSON.parse(readFileSync(join(STATE_DIR, 'guests.json'), 'utf8'))
    } catch {
      return {}
    }
  })()

  const guests = guestsByAge().map((name) => ({ name, size: guestCost(name), at: used[name] ?? 0 }))

  const evicted = []
  let total = guests.reduce((sum, guest) => sum + guest.size, 0)

  // Stale first, regardless of how much room there is. A guest nobody has
  // wanted in a fortnight is not earning its disk.
  for (const guest of guests) {
    if (Date.now() - guest.at <= keepMs) continue

    evicted.push({ ...guest, why: 'stale' })
    total -= guest.size

    if (!dry) forget(guest.name)
  }

  // Then oldest-first until the rest fits the budget.
  for (const guest of guests) {
    if (total <= budget) break

    if (evicted.some((gone) => gone.name === guest.name)) continue

    evicted.push({ ...guest, why: 'over budget' })
    total -= guest.size

    if (!dry) forget(guest.name)
  }

  // The evicted guests' frames are now orphaned too.
  const after = evicted.length > 0 ? sweepOrphans(dry) : { count: 0, freed: 0 }

  return {
    orphans: { count: orphans.count + after.count, freed: orphans.freed + after.freed },
    guests: guests.length,
    evicted,
    remaining: total,
    budget,
  }
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)}MB`

if (process.argv[1] && process.argv[1].endsWith('prune.mjs')) {
  const dry = process.argv.includes('--dry')
  const result = prune({ dry })

  console.log(`\n  ${dry ? 'would free' : 'freed'}\n`)

  if (result.orphans.count) {
    console.log(`   ${String(result.orphans.count).padStart(4)} orphaned frames   ${mb(result.orphans.freed)}`)
  }

  for (const guest of result.evicted) {
    console.log(`   ${guest.name.padEnd(16)} ${mb(guest.size).padStart(8)}   ${guest.why}`)
  }

  if (!result.orphans.count && result.evicted.length === 0) console.log('   nothing to do')

  console.log(`\n  ${result.guests - result.evicted.length} guests kept, ${mb(result.remaining)} of ${mb(result.budget)}\n`)
}
