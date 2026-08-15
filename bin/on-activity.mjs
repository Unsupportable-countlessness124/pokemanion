// Hook handler. Records whether Claude is working so the status line knows
// whether to animate. Writes one small file and exits; it must never be the
// reason a prompt is slow, so everything here is best effort.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { STATE_DIR, clearState, loadConfig, readState, writeState } from '../src/config.mjs'
import { closeWindow, openWindow } from '../src/companion.mjs'

const WORKING = new Set(['UserPromptSubmit', 'PreToolUse', 'PostToolUse'])
const IDLE = new Set(['Stop', 'SessionEnd', 'SessionStart'])

// The same state under two names. Claude Code calls it Notification, Codex
// calls it PermissionRequest, and both mean the agent has stopped to ask you
// something — which is not working, whatever the last tool hook said.
//
// Everything else about the two is identical: same event names, same JSON on
// stdin, same field names, same exit-2-to-block. This file needed no other
// change to serve both, which is the only reason Codex support is a config
// question rather than a port.
const WAITING = new Set(['Notification', 'PermissionRequest'])

const read = () => {
  try {
    return JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    return {}
  }
}

try {
  const payload = read()

  // Which hooks actually fire, and when. Claude Code documents the events but
  // not what it does with them at the edges — whether interrupting a tool still
  // reports its PostToolUse, whether Stop fires when you press escape — and the
  // sprite is wrong exactly when an assumption about that is wrong. `npm run
  // watch` reads the other half; this is the hooks' own account.
  if (process.env.PIXEL_RUNNER_LOG_HOOK || loadConfig().logHooks) {
    const { appendFileSync, mkdirSync } = await import('node:fs')
    const { STATE_DIR } = await import('../src/config.mjs')

    try {
      mkdirSync(STATE_DIR, { recursive: true })
      // Session events are logged whole. They are rare, and they are the ones
      // whose payload we have to reason about — which sessions deserve a pane
      // is decided from what SessionStart says about itself.
      const session = /^Session/.test(payload?.hook_event_name ?? '')

      // Whether `claude --pikachu` reached this far. The flag is lifted by a
      // shell function and carried in the environment, and every link in that
      // chain is testable except this one — whether Claude Code hands its own
      // environment to the hooks it runs. Recorded so it can be seen rather
      // than assumed.
      const asked = process.env.PIXEL_RUNNER_SPECIES ?? null

      appendFileSync(
        `${STATE_DIR}/hooks.jsonl`,
        `${JSON.stringify(
          session
            ? { at: Date.now(), asked, ...payload }
            : {
                at: Date.now(),
                asked,
                event: payload?.hook_event_name,
                session: payload?.session_id,
                tool: payload?.tool_name ?? null,
              },
        )}\n`,
      )
    } catch {}
  }

  const event = payload?.hook_event_name

  // Everything is keyed by the session that sent the hook, so two Claude
  // windows never see each other's state.
  const session = payload.session_id

  // A prompt that is only `--pikachu` is aimed at the pane, not at Claude.
  //
  // Handled before anything else, and before the state is marked working: this
  // prompt is about to be blocked, so no turn is starting and saying one did
  // would leave the sprite running against a turn that never happened.
  if (event === 'UserPromptSubmit') {
    const { parse, describe } = await import('../src/switch.mjs')
    const { available, ensure, knownCount } = await import('../src/roster.mjs')
    const { speciesFileFor } = await import('../src/companion.mjs')

    const asked = parse(payload.prompt)

    if (asked) {
      const pool = available()
      const file = speciesFileFor(session)

      let current = null

      try {
        current = readFileSync(file, 'utf8').trim() || null
      } catch {}

      // `--dex` answers and changes nothing. It is still blocked, because the
      // point is to look something up without spending a turn on it.
      if (asked.kind === 'dex') {
        const { render, search, detail, entry, exactMatch, paneCard, all } = await import('../src/dex.mjs')
        const { fetchedGuests } = await import('../src/roster.mjs')

        if (!asked.query) {
          const here = [...pool.map(entry), ...fetchedGuests().map(entry)]

          process.stderr.write(
            `${all().length} available, ${pool.length} residents, ${fetchedGuests().length} guests on disk\n\n` +
              `${render(here, 40, false)}\n\n--dex <name|type|number> to search\n`,
          )
        } else {
          // `--dex current` means this pane, not "whatever panes exist" — the
          // session asking already knows which Pokemon it is holding, so it
          // answers with that one's card rather than a list of every window.
          const asking = asked.query.trim().toLowerCase()
          const mine = asking === 'current' ? current : null

          // Without a claim of its own, "current" has no answer. Falling back
          // to a search would list what *other* windows are holding, under a
          // word that promises this one.
          if (asking === 'current' && !mine) {
            process.stderr.write('no Pokemon claimed for this session yet\n')
            process.exit(2)
          }

          // `--dex current` answers in the pane and nowhere else.
          //
          // It used to do both, and the pane was the smaller half of what you
          // got: the same stats arrived in the conversation at the same moment,
          // which is the thing this command exists to avoid. You asked about the
          // Pokemon you are already looking at, so the answer belongs beside it.
          //
          // `--dex random` still answers in the conversation, because there is
          // nothing to look at — it is one you have not summoned, and putting
          // its card in the pane would label the wrong Pokemon.
          if (mine) {
            const { mkdirSync, writeFileSync } = await import('node:fs')
            const { STATE_DIR } = await import('../src/config.mjs')

            try {
              mkdirSync(STATE_DIR, { recursive: true })
              writeFileSync(`${STATE_DIR}/window-${String(session).replace(/[^\w.-]/g, '')}.card`, paneCard(entry(mine)).join('\n'))
            } catch {}

            // One line rather than none. The prompt is erased either way, and a
            // prompt that vanishes in silence reads as a command that failed —
            // so this says where the answer went without being the answer.
            process.stderr.write(`${entry(mine).title} — beside the pane\n`)
            process.exit(2)
          }

          const found = search(asked.query)
          const hit = exactMatch(asked.query)

          // An exact name, or a single answer, gets the card; several get the
          // table. The same split the command line makes, because it is about
          // the shape of the answer rather than where it is being read.
          if (found.length === 0 && !hit) {
            const { suggest, unregistered } = await import('../src/switch.mjs')
            const meant = suggest(asked.query, pool)
            // Spelled correctly, drawn never. Worth saying, because "nothing
            // matches" invites you to try spelling it again.
            const known = unregistered(asked.query)

            process.stderr.write(
              known
                ? `${known.title} — #${known.num}, no data\n\nreal, but never drawn as a Gen 5 sprite, so it cannot be summoned\n`
                : `nothing matches "${asked.query}"${meant ? `\n\ndid you mean: ${meant}` : ''}\n`,
            )
          } else if (hit || found.length === 1) {
            const row = hit ? entry(hit) : found[0]
            // Forms, not everything that matched — the same count the command
            // line makes, and wrong here for the same reason: the follow-up it
            // offers searches the prefix, so a match without that prefix is
            // something that line cannot find.
            const others = found.filter((other) => other.name.startsWith(`${row.name}-`)).length

            process.stderr.write(
              `${detail(row, false)}\n` +
                (others > 0 ? `\n${others} other form${others === 1 ? '' : 's'} — --dex ${row.name}-\n` : ''),
            )
          } else {
            process.stderr.write(`${render(found, 25, false)}\n\n${found.length} found — type --<name> to summon\n`)
          }
        }

        process.exit(2)
      }

      // Rolled here rather than in the parser, and turned into an ordinary
      // switch, so everything downstream — fetching, the claim, the reply — is
      // the same code that handles a name typed out in full.
      if (asked.kind === 'random') {
        const { pickRandom, entry } = await import('../src/dex.mjs')

        for (let attempt = 0; attempt < 5 && asked.kind === 'random'; attempt++) {
          const pick = pickRandom()

          if (ensure(pick)) {
            const row = entry(pick)

            asked.kind = 'switch'
            asked.name = pick
            asked.rolled = `${row.title} #${row.num || '?'} ${row.types}`
          }
        }

        if (asked.kind === 'random') {
          process.stderr.write('could not fetch a random one\n')
          process.exit(2)
        }
      }

      // A guest has to be on disk before the claim names it, because the pane
      // refuses to switch to a species whose files are missing — and refuses
      // silently, which would read as the command doing nothing. This is the
      // one place a hook goes to the network, and only the first time a given
      // Pokemon is asked for.
      if (asked.kind === 'switch' && asked.guest && !ensure(asked.name)) {
        process.stderr.write(`could not fetch ${asked.name}\n`)
        process.exit(2)
      }

      // Written even when it is the name already showing. The pane reloads on
      // any write, so asking for the one you have is how you make it pick up a
      // sprite that changed on disk.
      if (asked.kind === 'switch') {
        const { mkdirSync, writeFileSync } = await import('node:fs')
        const { STATE_DIR } = await import('../src/config.mjs')
        const { rememberSpecies } = await import('../src/assigned.mjs')

        // The pane watches this file. Writing it is the whole switch — no new
        // window, no restart, and the claim stays correct for other terminals.
        mkdirSync(STATE_DIR, { recursive: true })
        writeFileSync(file, asked.name)

        // And remembered, because the claim above dies with the pane. Typing
        // `--gengar` and having the pane come back as something else after a
        // restart is the same bug as the rotation one, arrived at from the
        // other direction: the switch was never written anywhere that lasts.
        rememberSpecies(session, asked.name, asked.rolled ? 'rolled' : 'switched')
      }

      // Exit 2 blocks the prompt and erases it, and shows this to you as the
      // reason. That is what keeps `--pikachu` from being sent to Claude as a
      // message and answered as one.
      // The one place we can actually reach someone.
      //
      // Every other channel is a hook whose output goes nowhere: SessionStart
      // writes to a stderr nobody reads, and a pane that never opens looks the
      // same as one you did not ask for. A blocked prompt is different — its
      // stderr is shown to you, in the conversation, as the reason.
      //
      // So if the two things the sprite cannot work without are missing, this
      // is where to say so. Only when something is actually wrong, and only on
      // a command that was going to answer anyway.
      const { hasGhostty, chafaFix } = await import('../src/bootstrap.mjs')
      const { spawnSync: probe } = await import('node:child_process')
      const missing = [
        hasGhostty() ? null : 'Ghostty — the pane is a Ghostty split (https://ghostty.org)',
        probe('command', ['-v', 'chafa'], { shell: true }).status === 0 ? null : chafaFix(),
      ].filter(Boolean)

      process.stderr.write(
        `${describe(asked, pool, current, knownCount() - pool.length)}\n` +
          (missing.length > 0 ? `\nno pane yet, missing:\n  ${missing.join('\n  ')}\n` : ''),
      )
      process.exit(2)
    }
  }

  if (WORKING.has(event)) {
    const now = Date.now()
    const previous = event === 'UserPromptSubmit' ? null : readState(session)

    writeState(session, {
      state: 'working',
      at: now,
      // When this turn began. Only a prompt starts one, and the tool hooks that
      // follow carry it forward unchanged — so an interruption can be compared
      // against the turn it interrupted rather than against whichever hook
      // happened to fire last. A tool interrupted mid-run still reports its
      // PostToolUse afterwards, and without this that lands newer than the
      // interruption and the sprite carries on running.
      promptAt: previous?.state === 'working' ? (previous.promptAt ?? previous.at ?? now) : now,
      // Where Claude writes this session's transcript. Pressing escape appends
      // an interruptedMessageId to it, which is the only trace an interruption
      // leaves anywhere — there is no hook for it.
      transcript: payload.transcript_path ?? null,
      // Only PreToolUse means a tool is in flight. PostToolUse means it
      // finished, so the tool is cleared and the heartbeat takes over deciding
      // whether Claude is still busy.
      tool: event === 'PreToolUse' ? (payload.tool_name ?? null) : null,
    })

    // Opening a pane here as well was tried, and removed.
    //
    // The idea was to paper over the two agents disagreeing about when a session
    // starts — Claude Code fires SessionStart at launch, Codex when you send
    // your first prompt. It does not help: on Codex those two events arrive in
    // the same second, because that second is when Codex decides a session
    // exists at all. There is no earlier hook to use.
    //
    // And it broke something. With randomPokemon off, chooseSpecies returns null
    // and nothing is recorded, so "has this session been given a Pokemon yet"
    // was false forever and every prompt attempted another split.
    //
    // The honest position is that the pane appears at launch on Claude and at
    // the first message on Codex, and that this is a difference between the
    // agents rather than something to work around.
  } else if (event === 'SessionEnd') {
    // The sprite belongs to this session, so it goes when the session does.
    closeWindow(session)
    clearState(session)
  } else if (IDLE.has(event)) {
    writeState(session, {
      state: 'idle',
      at: Date.now(),
      tool: null,
      transcript: payload.transcript_path ?? null,
    })

    // A new session gets a sprite of its own, unless one is already up for it
    // — or unless it is a background agent, which has no terminal to put one in.
    if (event === 'SessionStart' && loadConfig().autoWindow) {
      // Installed as a plugin, nothing ran `npm run setup`, so the one Ghostty
      // keybind the pane needs was never written — and without it the split
      // never collapses and the sprite arrives in a pane taking half the
      // window. That reads as broken rather than as unconfigured.
      //
      // Done here rather than left to the user because there is nowhere to tell
      // them: a SessionStart hook's output goes nowhere anyone reads. It is the
      // same idempotent write `npm run setup` performs — backed up, inside its
      // own markers, removed by `npm run ghostty -- --remove` — and a config
      // that already has the binding, by our hand or theirs, is left alone.
      //
      // Once per install. `install` is cheap when there is nothing to do, but
      // reading one file is cheaper, and this runs on every session.
      const done = join(STATE_DIR, 'bootstrapped')

      if (!existsSync(done)) {
        try {
          const { install } = await import('../src/ghostty.mjs')
          const { bootstrapChafa, hasGhostty } = await import('../src/bootstrap.mjs')

          // Only if Ghostty is actually here. Writing a config file for an
          // application someone does not have is litter, and it would sit in
          // ~/.config waiting to confuse them later.
          if (hasGhostty()) install()

          bootstrapChafa()
          mkdirSync(STATE_DIR, { recursive: true })
          writeFileSync(done, new Date().toISOString())
        } catch {}
      }

      openWindow(session, payload.source ?? null)
    }
  } else if (WAITING.has(event)) {
    // Claude wants something from you, so it is not working — whatever the last
    // tool hook said. The transcript is kept so the sprite can go on watching
    // it, and the tool cleared so nothing counts as still in flight.
    writeState(session, {
      state: 'waiting',
      at: Date.now(),
      tool: null,
      transcript: payload.transcript_path ?? readState(session)?.transcript ?? null,
    })
  }
} catch {}

process.exit(0)
