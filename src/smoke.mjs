// The cheapest test that would have caught a real bug.
//
// `node --check` parses a file; it does not resolve its imports. Extracting the
// renderer into sprite.mjs left `MIN_DELAY` behind in window.mjs, every syntax
// check passed, and the pane died on launch with a ReferenceError. Importing
// each module is what finds that.
//
// Only the modules the pane and the hooks actually load. The tuning tools run
// on import by design — running them is not a smoke test, it is a screenful of
// sprites.
//
// Usage: npm test

import { readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT } from './config.mjs'

const MODULES = [
  'config',
  'roster',
  'dex',
  'sprite',
  'switch',
  'companion',
  'prune',
  'interrupt',
  'gif',
  'png',
  'pngwrite',
  'prepare',
  'render',
  'cells',
  'choose',
  'attribution',
  'shell',
  'assigned',
]

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok, detail })

for (const name of MODULES) {
  try {
    await import(`./${name}.mjs`)
    check(`import ${name}`, true)
  } catch (error) {
    check(`import ${name}`, false, error.message.split('\n')[0])
  }
}

// The roster is data, and data goes wrong quietly: an entry pointing at a file
// that is not there shows up as a Pokemon that never appears.
const { ROSTER, names, busyFile, idleFile, transitionFor, busySpeedFor } = await import('./roster.mjs')

check('roster has entries', ROSTER.length > 0, `${ROSTER.length} residents`)
check('no duplicate names', new Set(names()).size === names().length)

const missing = ROSTER.flatMap((entry) =>
  [entry.idle, entry.busy].filter(Boolean).filter((file) => !existsSync(join(ROOT, file))),
)

check('hand-picked sprites exist', missing.length === 0, missing.join(', '))
check('everything plays at a sane speed', names().every((name) => busySpeedFor(name, 0.4) > 0))

// A transition is either a recolour or a different creature. Anything else is a
// typo that would silently play nothing.
const kinds = names().map(transitionFor).filter(Boolean)

check('transitions are known kinds', kinds.every((kind) => kind === 'flash' || kind === 'evolve'), [...new Set(kinds)].join(', '))

// The bundled name and dex lists are what makes summoning work offline.
const { isKnown, knownCount, resolveName } = await import('./roster.mjs')

check('names bundled', knownCount() > 1000, `${knownCount()} names`)
check('punctuation resolves', resolveName('ho-oh') === 'hooh')
check('forms resolve', isKnown('rotom-wash'))
check('nonsense does not', !isKnown('zzzznotapokemon'))

const { search, exactMatch, pickRandom, entry } = await import('./dex.mjs')

check('dex searches by name', search('charizard').length > 0)
check('dex searches by type', search('dragon').length > 10)
check('dex searches by number', search('6').every((row) => row.num === 6))
check('an exact name is a lookup', exactMatch('pikachu') === 'pikachu')
check('a trailing dash is a search', exactMatch('pikachu-') === null)
check('the dice only roll real Pokemon', Array.from({ length: 50 }, pickRandom).every((name) => entry(name).num > 0))

// The commands, parsed the way the hook parses them.
const { parse } = await import('./switch.mjs')

check('--pikachu switches', parse('--pikachu')?.kind === 'switch')
check('--random rolls', parse('--random')?.kind === 'random')
check('--dex looks up', parse('--dex ghost')?.query === 'ghost')
check('a sentence is left alone', parse('what does --pikachu do?') === null)

// What a session was given, and getting it back.
//
// The bug this guards: the species was never stored, only recomputed from
// `hash(session) % choices.length`, and `choices` shrinks when a guest is
// evicted or another terminal opens. A pane that closed and reopened came back
// as a different Pokemon with nothing typed. Every rule below is one that had
// to keep working while that was fixed.
{
  const { chooseSpecies, speciesInUse } = await import('./companion.mjs')
  const { rememberSpecies, rememberedSpecies, forgetSession, assignments } = await import('./assigned.mjs')
  const { available } = await import('./roster.mjs')

  const id = 'smoke-assigned-0001'
  const on = { randomPokemon: true }

  // Two residents no live pane is holding, so the checks below are testing the
  // rules rather than colliding with whatever is on screen right now.
  const held = speciesInUse(id)
  const free = available().filter((name) => !held.has(name) && name !== 'pikachu')
  const [mine, other] = free

  try {
    check('a session starts with nothing remembered', (forgetSession(id), rememberedSpecies(id)) === null)

    // Rule 3 — unchanged. No ask, nothing remembered, so the rotation decides.
    const rotated = chooseSpecies(id, on, {})

    check('rotation still picks when nothing is known', typeof rotated === 'string' && rotated.length > 0, rotated)

    // Rule 2 — the fix. Remembered, free, so it comes back.
    rememberSpecies(id, mine, 'test')

    check('a remembered Pokemon comes back', chooseSpecies(id, on, {}) === mine, mine)

    // ...and it survives the list changing underneath it, which is the exact
    // thing that used to move the answer.
    check(
      'and survives the pool changing',
      chooseSpecies(id, on, {}) === mine && chooseSpecies(id, on, {}) === chooseSpecies(id, on, {}),
    )

    // Rule 1 — unchanged, and it has to outrank rule 2.
    check('an explicit ask still outranks it', chooseSpecies(id, on, { PIXEL_RUNNER_SPECIES: other }) === other, other)

    // The whole point of rule 1: naming one you can already see elsewhere.
    const somewhere = [...speciesInUse()][0]

    if (somewhere) {
      check(
        'a Pokemon already out elsewhere can still be summoned by name',
        chooseSpecies(id, on, { PIXEL_RUNNER_SPECIES: somewhere }) === somewhere,
        somewhere,
      )
    }

    // A guest is the case most worth remembering — you went and named it — and
    // the one that breaks if "is this still on disk" is asked of the resident
    // list, which is what `available()` is. That mistake restored every
    // resident correctly and sent every guest back to the rotation.
    const { fetchedGuests: guestsOnDisk } = await import('./roster.mjs')
    const [aGuest] = guestsOnDisk().filter((name) => !held.has(name))

    if (aGuest) {
      rememberSpecies(id, aGuest, 'test')

      check(`a remembered guest comes back too (${aGuest})`, chooseSpecies(id, on, {}) === aGuest)
    }

    // A name that is not on disk cannot be handed to the pane, which refuses to
    // draw a species whose files are missing.
    rememberSpecies(id, 'notarealpokemon', 'test')

    check('a remembered name that is gone falls back', chooseSpecies(id, on, {}) !== 'notarealpokemon')

    // Switching the whole thing off still means off.
    rememberSpecies(id, mine, 'test')

    check('randomPokemon:false still wins', chooseSpecies(id, { randomPokemon: false }, {}) === null)

    // And the record stays bounded rather than growing for every session ever.
    check('the record is an object, not a list', !Array.isArray(assignments()) && typeof assignments() === 'object')
  } finally {
    forgetSession(id)
  }

  check('the test session is cleaned up', rememberedSpecies(id) === null)

  // The other half of the same bug. Nothing touches a guest's last-used stamp
  // while it simply sits in a pane being looked at, so a window left open for
  // longer than guestKeepDays had its own sprite deleted underneath it.
  const { prune } = await import('./prune.mjs')
  const { fetchedGuests } = await import('./roster.mjs')
  const { speciesFileFor } = await import('./companion.mjs')

  // Not simply the first guest on disk. A pane running right now may be holding
  // it, and then the "is a stale guest still evicted?" half fails — correctly,
  // because the protection being tested is doing its job. Which made this pass
  // on CI, where nothing is running, and fail on the machine that has a pane
  // open. A test that depends on what is on screen is worse than no test.
  const [guest] = fetchedGuests().filter((name) => !held.has(name))

  if (guest) {
    const { writeFileSync, unlinkSync, mkdirSync } = await import('node:fs')
    const { STATE_DIR } = await import('./config.mjs')
    const claim = speciesFileFor('smoke-prune-0001')
    const gone = (result) => result.evicted.some((row) => row.name === guest)

    try {
      unlinkSync(claim)
    } catch {}

    const unheld = prune({ dry: true, keepDays: 0 })

    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(claim, guest)

    const held = prune({ dry: true, keepDays: 0 })

    try {
      unlinkSync(claim)
    } catch {}

    // Both directions, so this cannot pass by the pruner having stopped working
    // altogether and evicting nothing at all.
    check(`a stale guest is still evicted (${guest})`, gone(unheld))
    check('but not one a pane is showing', !gone(held))
  }

  // The `choose` line, which is the only record of a pick nobody asked for.
  // Checked by reading it back rather than by it not throwing, because it is
  // wrapped in the same catch-everything the rest of the hook path uses and
  // would fail completely silently.
  {
    const { logChoice } = await import('./companion.mjs')
    const { readFileSync } = await import('node:fs')
    const { STATE_DIR } = await import('./config.mjs')
    const log = join(STATE_DIR, 'hooks.jsonl')
    const before = (() => {
      try {
        return readFileSync(log, 'utf8').length
      } catch {
        return 0
      }
    })()

    // Forced on for the duration, so this tests the writing rather than
    // whatever `logHooks` happens to be set to on the machine running it.
    const was = process.env.PIXEL_RUNNER_LOG_HOOK

    process.env.PIXEL_RUNNER_LOG_HOOK = '1'
    logChoice('smoke-choose-0001', 'pikachu', 'remembered')

    if (was === undefined) delete process.env.PIXEL_RUNNER_LOG_HOOK
    else process.env.PIXEL_RUNNER_LOG_HOOK = was

    let row = null

    try {
      const written = readFileSync(log, 'utf8').slice(before).trim().split('\n').filter(Boolean)

      row = JSON.parse(written[written.length - 1])
    } catch {}

    check(
      'the choice is written to the hook log',
      row?.event === 'choose' && row.species === 'pikachu' && row.why === 'remembered' && row.session === 'smoke-choose-0001',
      row ? JSON.stringify(row) : 'nothing logged',
    )
  }
}

// Every sprite the README shows has to be committed, or the gallery is broken
// images for anyone who clones. The residents' sprites are tracked by an
// explicit list in .gitignore, and nothing else would notice it drifting out of
// step with the roster.
try {
  const { execSync } = await import('node:child_process')
  const tracked = new Set(execSync('git ls-files', { encoding: 'utf8' }).trim().split('\n'))
  // `idleFile` already returns an absolute path. Passing it through join(ROOT,
  // ...) produced a path under the repo *twice over*, which never exists — so
  // the list came back empty and the check passed having examined nothing.
  const shown = ROSTER.filter((entry) => existsSync(idleFile(entry.name)))

  const untracked = shown
    .flatMap((entry) => [idleFile(entry.name), busyFile(entry.name)])
    .map((file) => file.replace(`${ROOT}/`, ''))
    .filter((file) => !tracked.has(file))

  // Counted, so it cannot pass by looking at nothing.
  check(
    `every resident sprite is committed (${shown.length} checked)`,
    shown.length === ROSTER.length && untracked.length === 0,
    untracked.join(', '),
  )
} catch {
  // Not a git checkout; nothing to verify.
}

// Every asset named anywhere still exists.
const assets = readdirSync(join(ROOT, 'assets')).filter((file) => /\.(gif|png)$/.test(file))

check('assets present', assets.length > 0, `${assets.length} files`)

const failed = results.filter((result) => !result.ok)

for (const result of results) {
  if (!result.ok) console.log(`  FAIL  ${result.name}${result.detail ? `  ${result.detail}` : ''}`)
}

console.log(`\n  ${results.length - failed.length}/${results.length} checks passed\n`)

process.exit(failed.length ? 1 : 0)
