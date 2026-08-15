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
import { dirname, join } from 'node:path'
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
  'ghostty',
  'hint',
  'agents',
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

// Ash is a resident the pokedex has never heard of, so every part of the dex
// reaches him by a different route than the other twelve.
const { detail, paneCard } = await import('./dex.mjs')

check('a resident who is not a Pokemon is still a lookup', exactMatch('ash') === 'ash')
check('and has a description rather than an empty fact table', detail(entry('ash'), false).includes('Pallet Town'))
check('and never rolls on the dice', !Array.from({ length: 50 }, pickRandom).includes('ash'))
check('his pane card fits the pane', paneCard(entry('ash')).every((line) => line.length <= 24))

// "N other forms" points at a prefix search, so anything without the prefix is
// not a form and the follow-up cannot find it. --dex mew counted Mewtwo.
const forms = (name) => search(name).filter((row) => row.name.startsWith(`${name}-`)).length

check('forms are counted by prefix, not by matching', forms('mew') === 0 && forms('pikachu') > 5)

// The commands, parsed the way the hook parses them.
const { parse } = await import('./switch.mjs')

check('--pikachu switches', parse('--pikachu')?.kind === 'switch')
check('--random rolls', parse('--random')?.kind === 'random')
check('--dex looks up', parse('--dex ghost')?.query === 'ghost')
// The argument is taken exactly as typed — one spelling to remember, not one
// plus a set of near-misses. The help lives in the failure instead.
check('--dex takes its argument verbatim', parse('--dex --current')?.query === '--current')
check('and keeps a trailing dash', parse('--dex pikachu-')?.query === 'pikachu-')

const { suggest } = await import('./switch.mjs')

// Every other command here is `--something`, so a dash on the argument is a
// habit rather than a misunderstanding, and `nothing matches "--current"` reads
// as a broken command. The suggestion is what makes strictness bearable.
check('a dashed argument is guessed at', suggest('--current') === '--dex current')
check('so is a dashed name', suggest('--pikachu') === '--dex pikachu')
// Silence beats a guess that leads to a second miss.
check('nonsense gets no guess', suggest('--zzznope') === null)
check('and a correct query needs none', suggest('current') === null)

// A correctly spelled Pokemon that was never drawn in Gen 5 is not a typo, and
// telling someone "no such one" invites them to try spelling it again.
const { unregistered } = await import('./switch.mjs')

check('a real but undrawn Pokemon is known as such', unregistered('urshifu')?.num === 892)
check('including one spelled with punctuation', unregistered('sirfetchd')?.num === 865)
check('nonsense is not mistaken for one', unregistered('zzznope') === null)
// The whole point of the list is that these are absent from the roster — if one
// ever gains a sprite it belongs in the dex, not in both places at once.
check(
  'and none of them is also summonable',
  !['urshifu', 'sirfetchd', 'chespin'].some((name) => isKnown(name)),
)

// Misspellings, which are the common case everywhere else.
const { nearest } = await import('./switch.mjs')

check('a typo finds its Pokemon', nearest('charizrd') === 'charizard')
// Dropped letters, which no safe edit-distance cap reaches: charzd is three
// edits from charizard but every letter of it is there, in order.
check('dropped letters find it too', nearest('charzd') === 'charizard')
check('and so does a heavily clipped name', nearest('squrtl') === 'squirtle')
// One edit from both Pichu and Pikachu; the resident is the better guess.
check('a tie goes to the resident', nearest('pikchu') === 'pikachu')
check('gibberish gets nothing', nearest('zzznope') === null)
check('and two letters are too few to guess from', nearest('pi') === null)

// The wrapper runs this against flags meant for Claude itself, so a false
// positive there talks over a real command. `--version` is two edits from
// Persian, which is why the outside check is capped at one.
const CLAUDE_FLAGS = ['resume', 'continue', 'print', 'model', 'help', 'version', 'verbose', 'debug', 'ide', 'settings', 'agents', 'fast', 'chrome', 'add-dir', 'session-id', 'fork-session', 'permission-mode', 'output-format', 'allowed-tools', 'max-turns', 'no-color', 'mcp-config']

check(
  `no Claude flag is mistaken for a Pokemon (${CLAUDE_FLAGS.length} checked)`,
  CLAUDE_FLAGS.every((flag) => nearest(flag, { maxEdits: 1 }) === null),
  CLAUDE_FLAGS.filter((flag) => nearest(flag, { maxEdits: 1 })).join(', '),
)
check('a sentence is left alone', parse('what does --pikachu do?') === null)

// Every path this writes into a shell command has to be quoted, because the
// repo may sit somewhere with a space in it — ~/Documents/My Projects is an
// ordinary place to put things. Unquoted, `claude --random` died with
// "no such file or directory: /Users/you/My" and the typo hint silently
// stopped working, while `claude --pikachu` kept working, which is the worst
// possible spread of symptoms to debug from.
{
  const { snippet } = await import('./shell.mjs')
  const { AGENTS: allAgents } = await import('./agents.mjs')
  // Explicit, because CI has no coding agent installed and detection would
  // return an empty list — the third time a test has quietly depended on what
  // happens to be on the machine running it.
  const text = snippet(allAgents)

  // Every occurrence of the repo path, and whether a quote sits immediately
  // before it. Matching on the path itself rather than on a shape — the first
  // attempt used a regex for "a slash not preceded by a quote", which matched
  // the middle of /Users/adbhut and reported four failures against correct code.
  const bare = []

  for (const file of [join(ROOT, 'bin', 'run.sh'), join(ROOT, 'assets', 'gen5-names.json')]) {
    let at = text.indexOf(file)

    while (at !== -1) {
      // A comment line is prose, not a command, and needs no quoting.
      const lineStart = text.lastIndexOf('\n', at) + 1

      if (text[at - 1] !== '"' && !text.slice(lineStart, at).trimStart().startsWith('#')) bare.push(file)

      at = text.indexOf(file, at + 1)
    }
  }

  check('every path in the shell wrapper is quoted', bare.length === 0, `${bare.length} bare: ${[...new Set(bare)].join(', ')}`)
  check('and the wrapper still references the launcher', text.includes(`"${join(ROOT, 'bin', 'run.sh')}"`))

  // The function itself runs under bash 3.2 — the version macOS ships — as well
  // as zsh; only the file it was written to was ever zsh-specific, which is why
  // this used to be documented as zsh-only.
  const { rcFile } = await import('./shell.mjs')
  const { mkdtempSync: rcTemp, writeFileSync: put, rmSync: drop } = await import('node:fs')
  const { tmpdir: temp } = await import('node:os')
  const bare2 = rcTemp(join(temp(), 'pokemanion-rc-'))
  const withBashrc = rcTemp(join(temp(), 'pokemanion-rc-'))

  put(join(withBashrc, '.bashrc'), '')

  // Intel Macs put Homebrew under /usr/local, Apple Silicon under
  // /opt/homebrew. run.sh has to know both, since it hunts for an interpreter
  // by absolute path when the PATH is trimmed. Only one file in the project
  // mentions an architecture-specific path at all, and this is it.
  {
    const { readFileSync: slurp } = await import('node:fs')
    const runner = slurp(join(ROOT, 'bin', 'run.sh'), 'utf8')

    check('run.sh knows the Apple Silicon brew path', runner.includes('/opt/homebrew/bin/node'))
    check('and the Intel one', runner.includes('/usr/local/bin/node'))
  }

  check('zsh installs into .zshrc', rcFile('/bin/zsh', bare2).endsWith('.zshrc'))
  check('bash installs into a bash file', rcFile('/bin/bash', bare2).endsWith('.bash_profile'))
  check('and prefers one that already exists', rcFile('/bin/bash', withBashrc).endsWith('.bashrc'))

  drop(bare2, { recursive: true, force: true })
  drop(withBashrc, { recursive: true, force: true })
}

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

    // Every resident by name, not just whichever one a pane happens to hold.
    // The version of this test that sampled the live panes only caught Ash
    // being unresolvable at launch on the day a pane happened to be showing
    // him — a resident whose name is not a Pokemon's takes a different route
    // through `ensure` than the other twelve, and nothing was walking it.
    const unreachable = names().filter(
      (name) => chooseSpecies(`ask-${name}`, on, { PIXEL_RUNNER_SPECIES: name }) !== name,
    )

    check('every resident can be asked for by name at launch', unreachable.length === 0, unreachable.join(' '))

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

// The three files that run their work the moment they are loaded.
//
// `MODULES` above cannot reach any of them: importing one would perform its job
// — install the thing, write to your home directory, or in on-activity's case
// call process.exit and end this test run *reporting success*. So they were the
// only user-facing code with nothing but `node --check` behind them, and
// `node --check` is exactly the check that missed MIN_DELAY.
//
// Run as subprocesses instead, each against the safe path it already documents.
// That executes the real top-level code without importing it.
{
  const { spawnSync } = await import('node:child_process')
  const { mkdtempSync, rmSync, readFileSync: read } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { sessionStateFile } = await import('./config.mjs')

  // Same spawn, but with arguments and a forced HOME — the agent-targeted
  // installs need both, and detection must never decide what a test exercises.
  const run2 = (file, args, home) =>
    spawnSync(process.execPath, [file, ...args], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, HOME: home } })

  const run = (file, { input = '', env = {} } = {}) =>
    spawnSync(process.execPath, [file], {
      cwd: ROOT,
      input,
      encoding: 'utf8',
      env: { ...process.env, ...env },
    })

  // 1. The hook handler. Its whole body sits in `try { } catch {}` and then
  //    exits 0, so a ReferenceError in it is not a crash — every hook silently
  //    becomes a no-op that reports success, and the sprite just stops
  //    responding with nothing said anywhere. Exit code proves nothing here;
  //    the only proof is whether it did the work.
  const hookSession = 'smoke-hook-0001'
  const stateFile = sessionStateFile(hookSession)

  try {
    rmSync(stateFile, { force: true })
  } catch {}

  const hook = run('bin/on-activity.mjs', {
    input: JSON.stringify({ hook_event_name: 'Stop', session_id: hookSession }),
  })

  let wrote = null

  try {
    wrote = JSON.parse(read(stateFile, 'utf8'))
  } catch {}

  check(
    'the hook handler actually handles a hook',
    hook.status === 0 && wrote?.state === 'idle',
    wrote ? `state=${wrote.state}` : 'wrote no state — it exits 0 even when it does nothing',
  )

  // Every lifecycle event, under both agents' names for them. The one that
  // differs is the waiting state: Claude calls it Notification, Codex calls it
  // PermissionRequest, and getting it wrong means the sprite runs while the
  // agent sits on an unanswered question.
  {
    // SessionStart is deliberately not in this list.
    //
    // It is the one event that opens a pane, and the handler under test is the
    // real one — so including it made `npm test` split a live terminal and
    // leave a sprite running. Two of them were sitting on screen before anyone
    // noticed, alongside the real sessions. A test suite that spawns windows on
    // the machine running it is worse than a slightly smaller test suite.
    //
    // Nothing is lost: SessionStart shares the idle branch with Stop, which is
    // covered, and the pane-opening path is exercised by the real agents rather
    // than by pretending to be one.
    const states = [
      ['UserPromptSubmit', 'working'],
      ['PreToolUse', 'working'],
      ['PostToolUse', 'working'],
      ['Stop', 'idle'],
      ['Notification', 'waiting'],
      ['PermissionRequest', 'waiting'],
    ]
    const lifecycle = 'smoke-lifecycle-0001'
    const wrong = []

    for (const [event, want] of states) {
      run('bin/on-activity.mjs', { input: JSON.stringify({ hook_event_name: event, session_id: lifecycle }) })

      let got = null

      try {
        got = JSON.parse(read(sessionStateFile(lifecycle), 'utf8')).state
      } catch {}

      if (got !== want) wrong.push(`${event}: ${got} not ${want}`)
    }

    check(`every lifecycle event maps to a state (${states.length} checked)`, wrong.length === 0, wrong.join(', '))
    rmSync(sessionStateFile(lifecycle), { force: true })
  }

  try {
    rmSync(stateFile, { force: true })
  } catch {}

  // 1b. Where each --dex answer goes. `current` describes the Pokemon already
  //     on screen, so it belongs beside it; everything else, `random` included,
  //     belongs in the conversation. Both used to answer in both places, which
  //     made `current` a slower way of getting the same wall of text.
  {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const { STATE_DIR } = await import('./config.mjs')
    const dexSession = 'smoke-dex-0001'
    const card = join(STATE_DIR, `window-${dexSession}.card`)

    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(join(STATE_DIR, `window-${dexSession}.species`), 'pikachu')
    rmSync(card, { force: true })

    const ask = (prompt) =>
      run('bin/on-activity.mjs', {
        input: JSON.stringify({ hook_event_name: 'UserPromptSubmit', session_id: dexSession, prompt }),
      })

    const current = ask('--dex current')
    const inPane = (() => {
      try {
        return read(card, 'utf8')
      } catch {
        return ''
      }
    })()

    // One line in the conversation, not the card. "no." is a field of the card
    // itself, so its absence is what proves the stats did not go to both.
    check(
      '--dex current answers in the pane',
      /pikachu/i.test(inPane) && current.stderr.trim().split('\n').length === 1 && !/no\./.test(current.stderr),
      current.stderr.trim().slice(0, 60),
    )

    const before = inPane
    const random = ask('--dex random')
    const afterRandom = (() => {
      try {
        return read(card, 'utf8')
      } catch {
        return ''
      }
    })()

    check(
      '--dex random answers in the conversation and leaves the pane alone',
      /no\./.test(random.stderr) && afterRandom === before,
      afterRandom === before ? 'pane untouched' : 'pane was overwritten',
    )

    rmSync(card, { force: true })
    rmSync(join(STATE_DIR, `window-${dexSession}.species`), { force: true })
  }

  // 1c. A half-finished download has to be able to say so.
  //
  //     `npm run roster` printed its per-entry results and exited 0 whatever
  //     happened, so with a failing network `npm run setup` ticked "downloading
  //     sprites ✓" and went on to report the whole install finished — leaving a
  //     pane that opens onto sprites that were never fetched.
  //
  //     Tested by taking one resident's files away and putting them back, with
  //     curl stubbed out so nothing can quietly re-download them mid-test.
  {
    const { renameSync, mkdtempSync: tempDir, writeFileSync: write, chmodSync } = await import('node:fs')
    const { idleFile, busyFile, ROSTER: roster } = await import('./roster.mjs')
    const victim = roster.find((row) => existsSync(idleFile(row.name)) && !row.idle)?.name
    const stub = tempDir(join(tmpdir(), 'pokemanion-nocurl-'))

    write(join(stub, 'curl'), '#!/bin/sh\nexit 6\n')
    chmodSync(join(stub, 'curl'), 0o755)

    if (victim) {
      const moved = join(stub, 'idle.gif')

      renameSync(idleFile(victim), moved)

      try {
        const broke = spawnSync(process.execPath, ['src/roster.mjs'], {
          cwd: ROOT,
          encoding: 'utf8',
          env: { ...process.env, PATH: `${stub}:${process.env.PATH}` },
        })

        check(`a failed download exits non-zero (${victim})`, broke.status === 1, `exit ${broke.status}`)
      } finally {
        renameSync(moved, idleFile(victim))
      }
    }

    const fine = spawnSync(process.execPath, ['src/roster.mjs'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, PATH: `${stub}:${process.env.PATH}` },
    })

    check('and exits zero when everything is present', fine.status === 0, `exit ${fine.status}`)

    rmSync(stub, { recursive: true, force: true })
  }

  // 1d. A pane that outlives the session that opened it.
  //
  //     Opening one takes a second or two — split the terminal, type a command,
  //     boot node — and for that stretch the pane exists with no pid file. A
  //     session ending inside that window found nothing to kill and returned,
  //     and the pane finished starting with nobody left to own it: a sprite for
  //     a session that no longer exists, holding a Pokemon it never released.
  //     That is how a second Pikachu appears beside a Gengar.
  //
  //     closeWindow leaves a note when it has no pid to signal. This is that
  //     note being honoured by a pane that starts afterwards.
  {
    const { closeWindow, closedFileFor } = await import('./companion.mjs')
    const orphan = 'smoke-orphan-0001'

    rmSync(closedFileFor(orphan), { force: true })
    closeWindow(orphan)

    check('closing a pane that has not started yet leaves a note', existsSync(closedFileFor(orphan)))

    const started = spawnSync(process.execPath, ['src/window.mjs', '4', `--session=${orphan}`], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 8000,
      env: { ...process.env, TERM: 'dumb' },
    })

    check('and a pane starting later reads it and exits', started.status === 0, `exit ${started.status}`)
    check('and the note is cleared afterwards', !existsSync(closedFileFor(orphan)))

    rmSync(closedFileFor(orphan), { force: true })
    const { STATE_DIR: sd } = await import('./config.mjs')
    rmSync(join(sd, `window-${orphan}.pid`), { force: true })
  }

  // 2. The installer, on the one path that is safe to run: a missing
  //    prerequisite. With no PATH there is no chafa, so it must stop at the
  //    preflight having written nothing. This is the promise the file makes in
  //    its own output, so the test is that promise rather than a restatement of
  //    the implementation.
  const blocked = run('src/setup.mjs', { env: { PATH: '' } })

  check(
    'setup stops on a missing prerequisite without touching anything',
    blocked.status === 1 && /nothing was changed/.test(blocked.stdout ?? ''),
    `exit ${blocked.status}`,
  )

  // 3. install.mjs edits ~/.claude/settings.json, which makes it the one file
  //    here worth testing most and the one hardest to test safely. homedir()
  //    honours $HOME, so pointing that at a scratch directory gives it a real
  //    settings file to edit that is not yours. Install then uninstall, because
  //    the half that breaks quietly is the removal: it matches our hooks by
  //    looking for 'pixel-runner' in the command, and leaving one behind means
  //    a hook firing at a file that no longer exists.
  const home = mkdtempSync(join(tmpdir(), 'pokemanion-smoke-'))

  // This used to stub build/frames.json, because install.mjs refused to run
  // without it. That guard is gone — it demanded a build for the status line,
  // which is not installed any more — and with it goes the reason a fresh clone
  // could not be installed at all.
  try {
    // The same shape install.mjs recognises: our launcher plus one of our
    // scripts. Counting by the old 'pixel-runner' string would have made this
    // test agree with the bug — it only ever matched because the development
    // folder happens to carry the project's old name.
    const ours = (settings) =>
      Object.values(settings.hooks ?? {})
        .flat()
        .filter((group) =>
          (group?.hooks ?? []).some(
            (hook) => String(hook?.command ?? '').includes('run.sh') && String(hook?.command ?? '').includes('on-activity.mjs'),
          ),
        ).length

    // Codex registers the same hooks in a file of its own. Everything else
    // about it is identical — same event names, same JSON on stdin, same field
    // names — which is why bin/on-activity.mjs serves both unchanged.
    {
      const codexHome = mkdtempSync(join(tmpdir(), 'pokemanion-codex-'))

      try {
        const wrote = spawnSync(process.execPath, ['install.mjs', '--codex'], {
          cwd: ROOT,
          encoding: 'utf8',
          env: { ...process.env, HOME: codexHome },
        })
        const file = join(codexHome, '.codex', 'hooks.json')
        const document = JSON.parse(read(file, 'utf8'))
        const events = Object.keys(document.hooks ?? {})

        check('codex hooks land in ~/.codex/hooks.json', wrote.status === 0 && events.length === 7, events.length + ' events')
        // Claude calls it Notification; Codex calls it PermissionRequest. Both
        // mean "waiting on you", and registering the wrong one means the sprite
        // runs while the agent sits on a question.
        check('and use PermissionRequest, not Notification', events.includes('PermissionRequest') && !events.includes('Notification'))
        // Codex has no spinner to theme, and an unknown key in its hooks file
        // would be rude at best.
        check('and carry no spinner verbs', !document.spinnerVerbs)

        const gone = spawnSync(process.execPath, ['install.mjs', '--codex', '--uninstall'], {
          cwd: ROOT,
          encoding: 'utf8',
          env: { ...process.env, HOME: codexHome },
        })

        check('and come back out again', gone.status === 0 && !JSON.parse(read(file, 'utf8')).hooks)

        // Codex's hooks file may already be somebody else's. Ours go in beside
        // theirs, survive being installed twice, and leave theirs behind when
        // removed — the same contract as Claude's settings.json, which holds far
        // more than hooks and has always been treated carefully.
        const { writeFileSync: put } = await import('node:fs')

        put(
          file,
          JSON.stringify({
            description: 'theirs',
            hooks: { Stop: [{ hooks: [{ type: 'command', command: '/opt/theirs/notify.sh' }] }] },
          }),
        )

        const theirs = () => {
          const doc = JSON.parse(read(file, 'utf8'))

          return {
            them: Object.values(doc.hooks ?? {}).flat().filter((g) => JSON.stringify(g).includes('/opt/theirs')).length,
            us: Object.values(doc.hooks ?? {}).flat().filter((g) => JSON.stringify(g).includes('on-activity.mjs')).length,
            note: doc.description,
          }
        }

        spawnSync(process.execPath, ['install.mjs', '--codex'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, HOME: codexHome } })
        spawnSync(process.execPath, ['install.mjs', '--codex'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, HOME: codexHome } })

        const after = theirs()

        check("another tool's codex hooks survive ours", after.them === 1 && after.us === 7 && after.note === 'theirs', JSON.stringify(after))

        spawnSync(process.execPath, ['install.mjs', '--codex', '--uninstall'], {
          cwd: ROOT,
          encoding: 'utf8',
          env: { ...process.env, HOME: codexHome },
        })

        const left = theirs()

        check('and are still there after ours are removed', left.them === 1 && left.us === 0, JSON.stringify(left))
      } catch (error) {
        check('codex install', false, error.message.split('\n')[0])
      } finally {
        rmSync(codexHome, { recursive: true, force: true })
      }
    }

    const installed = run2('install.mjs', ['--claude'], home)
    const after = JSON.parse(read(join(home, '.claude', 'settings.json'), 'utf8'))

    check('install registers its hooks', installed.status === 0 && ours(after) > 0, `${ours(after)} hooks`)

    const removed = run2('install.mjs', ['--claude'], home)
    const cleaned = JSON.parse(read(join(home, '.claude', 'settings.json'), 'utf8'))

    // Re-running must not stack a second copy — that is what `withoutOurs` is
    // for, and a duplicate would fire every hook twice.
    check('and does not add them twice', removed.status === 0 && ours(cleaned) === ours(after), `${ours(cleaned)} hooks`)

    const uninstalled = run2('install.mjs', ['--claude'], home)

    // `--uninstall` is passed by argv, not env, so it needs its own spawn.
    const gone = spawnSync(process.execPath, ['install.mjs', '--claude', '--uninstall'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, HOME: home },
    })
    const emptied = JSON.parse(read(join(home, '.claude', 'settings.json'), 'utf8'))

    check('uninstall removes every one of them', gone.status === 0 && ours(emptied) === 0, `${ours(emptied)} left`)

    void uninstalled
  } catch (error) {
    check('install.mjs runs against a scratch HOME', false, error.message.split('\n')[0])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }

  // The Ghostty keybind. Without it the split opens and is never collapsed, so
  // the pane arrives at half the window height — which looks like a layout bug
  // rather than a missing line of config, and is what everyone but the machine
  // this was built on actually got.
  //
  // Run as a subprocess for the same reason as the rest: CONFIG is resolved
  // from homedir() at import time, so only a child process can be pointed
  // somewhere safe.
  const ghosttyHome = mkdtempSync(join(tmpdir(), 'pokemanion-ghostty-'))

  try {
    const config = join(ghosttyHome, '.config', 'ghostty', 'config')
    const ghostty = (...args) =>
      spawnSync(process.execPath, ['src/ghostty.mjs', ...args], {
        cwd: ROOT,
        encoding: 'utf8',
        env: { ...process.env, HOME: ghosttyHome },
      })

    ghostty('--install')

    const written = (() => {
      try {
        return read(config, 'utf8')
      } catch {
        return ''
      }
    })()

    check(
      'the Ghostty resize keybind is written',
      /resize_split:down,2000/.test(written),
      written ? 'written' : 'no config file created',
    )

    ghostty('--install')

    const twice = read(config, 'utf8')
    const count = (twice.match(/resize_split:down/g) ?? []).length

    check('and not written twice', count === 1, `${count} copies`)

    ghostty('--remove')

    const left = read(config, 'utf8')

    check('and can be removed again', !/resize_split:down/.test(left), left.trim() ? 'other lines kept' : 'empty')

    // A config that already has the keybind — added by hand, as it was here —
    // must be left exactly alone rather than gaining a second copy.
    const { mkdirSync, writeFileSync } = await import('node:fs')

    mkdirSync(dirname(config), { recursive: true })
    writeFileSync(config, 'keybind = super+ctrl+shift+arrow_down=resize_split:down,2000\nkeybind = super+ctrl+shift+arrow_up=resize_split:up,2000\n')

    const before = read(config, 'utf8')

    ghostty('--install')

    check('a hand-written keybind is left alone', read(config, 'utf8') === before)
  } finally {
    rmSync(ghosttyHome, { recursive: true, force: true })
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
