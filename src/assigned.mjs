// What each session was given, remembered across pane restarts.
//
// The `.species` file next to it does two jobs that look like one. It says
// "this pane is showing Cubone", and it says "Cubone is taken, give the next
// terminal something else". The second job has to end the moment the pane does
// — that is how Pikachu comes back when you close a window — so the pane
// deletes the file on the way out, and takes the first job's answer with it.
//
// Which meant the species was never really stored, only recomputed. `pickFor`
// hashes the session id and counts that far into the list of Pokemon nobody is
// holding, and both the list and the holders change on their own: a guest goes
// stale and the pruner evicts it, another terminal opens or closes. Count the
// same distance into a shorter list and you land somewhere else. A pane that
// closed and reopened came back as a different Pokemon, with nothing typed.
//
// So the two jobs get two files. `.species` stays exactly as it was, ephemeral
// and released on exit. This one is the durable half: the session id and what
// it was given, written once and read back on every reopen.
//
// Deliberately depends on nothing but the config, so the pruner and the hook
// can both read it without dragging in the half of companion.mjs that launches
// terminals.

import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { STATE_DIR } from './config.mjs'

export const ASSIGNED_FILE = join(STATE_DIR, 'assigned.json')

// Session ids come from Claude Code and are already tame, but they end up in a
// filename's worth of trust either way. Same shape the pid and claim files use.
const safe = (id) => String(id ?? 'default').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64)

// A session nobody has opened in a month is not coming back, and the file is
// read on every SessionStart. Bounded twice — by age, and by a hard count, so a
// burst of short sessions in one day cannot outrun the age limit.
const KEEP_MS = 30 * 24 * 60 * 60 * 1000
const KEEP_MOST = 200

export const assignments = () => {
  try {
    const parsed = JSON.parse(readFileSync(ASSIGNED_FILE, 'utf8'))

    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    // Missing is the ordinary case on a fresh install. Corrupt is not worth
    // reporting either: the worst it costs is one re-pick, which is what
    // happened every time before this file existed.
    return {}
  }
}

const trim = (all) => {
  const rows = Object.entries(all)
    .filter(([, row]) => row && typeof row.species === 'string' && row.species)
    .sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0))
    .filter(([, row]) => Date.now() - (row.at ?? 0) < KEEP_MS)
    .slice(0, KEEP_MOST)

  return Object.fromEntries(rows)
}

// Last writer wins, and that is fine. Two hooks firing together can only be
// racing over the same session's own answer, and the loser's value is rewritten
// by the next hook a second later. Written through a temporary file so a reader
// arriving mid-write sees the old file whole rather than half of the new one.
const save = (all) => {
  try {
    mkdirSync(STATE_DIR, { recursive: true })

    const temporary = `${ASSIGNED_FILE}.${process.pid}.tmp`

    writeFileSync(temporary, `${JSON.stringify(trim(all), null, 1)}\n`)
    renameSync(temporary, ASSIGNED_FILE)
  } catch {}
}

// `why` is not read by anything. It is there because the log of how a pane got
// its Pokemon was the one thing missing when this bug had to be explained after
// the fact — a picked species was never written down anywhere, so there was no
// way to point at the moment one changed.
export const rememberSpecies = (id, species, why = 'picked') => {
  if (!species) return species

  const all = assignments()

  all[safe(id)] = { species, at: Date.now(), why }

  save(all)

  return species
}

export const rememberedSpecies = (id) => {
  const row = assignments()[safe(id)]

  return row && typeof row.species === 'string' && row.species ? row.species : null
}

export const forgetSession = (id) => {
  const all = assignments()

  if (!(safe(id) in all)) return false

  delete all[safe(id)]

  save(all)

  return true
}

// Every species some session is still counting on. The pruner asks, so that a
// guest is not evicted out from under the pane currently showing it.
export const assignedSpecies = () => new Set(Object.values(assignments()).map((row) => row.species))

if (process.argv[1] && process.argv[1].endsWith('assigned.mjs')) {
  const all = assignments()
  const rows = Object.entries(all).sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0))

  if (rows.length === 0) console.log('\n  nothing assigned yet\n')
  else {
    console.log()

    for (const [id, row] of rows) {
      console.log(
        `  ${id.slice(0, 8).padEnd(10)}${String(row.species).padEnd(14)}${String(row.why ?? '').padEnd(10)}` +
          `${new Date(row.at ?? 0).toISOString().slice(0, 16).replace('T', ' ')}`,
      )
    }

    console.log(`\n  ${rows.length} remembered\n`)
  }

  if (process.argv.includes('--forget')) {
    try {
      unlinkSync(ASSIGNED_FILE)
      console.log('  forgotten\n')
    } catch {}
  }
}
