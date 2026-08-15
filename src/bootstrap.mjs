// Fetching chafa on a plugin install, in the background, once.
//
// `npm run setup` refuses to continue without chafa and tells you how to get
// it. A plugin install has no such moment: nothing runs, nobody is asked
// anything, and the first sign of trouble is a pane that opens and stays empty
// because there is no renderer to draw with. There is nowhere to put a message
// either — a SessionStart hook's output goes nowhere anyone reads.
//
// So it is fetched. Three things make that defensible rather than presumptuous:
//
//   - You installed a plugin whose entire stated purpose is drawing a sprite in
//     a terminal. chafa is what does the drawing. It is not a side quest.
//   - chafa is a Homebrew *formula*, not a cask, so it needs no password and
//     touches nothing outside the Homebrew prefix.
//   - It is attempted once, only when Homebrew is already installed, and it is
//     written down in the log rather than done silently.
//
// Detached, because `brew install` takes tens of seconds and a hook must never
// be the reason a session is slow to start. The consequence is honest: the
// sprite does not work for the first minute of the first session, and then it
// does.
//
// Ghostty is deliberately not fetched. It is a GUI application, a cask, and can
// ask for a password — and the pane is a Ghostty split, so anyone who can see a
// pane at all already has it.

import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { STATE_DIR } from './config.mjs'

const have = (command) => spawnSync('command', ['-v', command], { shell: true, encoding: 'utf8' }).status === 0

// The pane is a Ghostty split, so this is the difference between the sprite
// working and nothing happening at all. Checked in several places rather than
// assumed, because the failure without it is silent: AppleScript answers
// "Can't get application" with error -1728 and the hook has nowhere to say so.
export const hasGhostty = () => existsSync('/Applications/Ghostty.app')

const note = (what) => {
  try {
    mkdirSync(STATE_DIR, { recursive: true })
    appendFileSync(join(STATE_DIR, 'hooks.jsonl'), `${JSON.stringify({ at: Date.now(), event: 'bootstrap', ...what })}\n`)
  } catch {}
}

export const bootstrapChafa = () => {
  if (have('chafa')) return 'already installed'

  // Without Homebrew there is nothing to do that would not be worse than doing
  // nothing — MacPorts wants a password, and building from source from inside a
  // hook is not a thing to start.
  if (!have('brew')) {
    note({ step: 'chafa missing, no brew', fix: 'npm run deps' })

    return 'no package manager'
  }

  try {
    // Detached and disowned: this outlives the hook, which exits in
    // milliseconds. stdio ignored because there is no terminal to write to.
    const child = spawn('brew', ['install', 'chafa'], { detached: true, stdio: 'ignore' })

    child.unref()
    note({ step: 'installing chafa in the background', pid: child.pid })

    return 'started'
  } catch (error) {
    note({ step: 'chafa install failed to start', error: String(error).slice(0, 120) })

    return 'failed'
  }
}

if (process.argv[1] && process.argv[1].endsWith('bootstrap.mjs')) {
  console.log(`\n  chafa: ${bootstrapChafa()}\n`)
}

// What to tell someone who has no chafa, given what they do have.
//
// "brew install chafa" is a dead end for anyone without Homebrew, and a plugin
// user cannot conveniently run `npm run deps` to be told the alternatives — the
// clone is buried in a plugins directory. So the advice is chosen here, from
// what is actually on the machine.
//
// There is no fourth option: chafa publishes no prebuilt macOS binary, so
// without a package manager it is a source build.
export const chafaFix = () => {
  if (have('brew')) return 'chafa — it draws the sprite (brew install chafa)'
  if (have('port')) return 'chafa — it draws the sprite (sudo port install chafa)'

  return 'chafa — it draws the sprite, and needs Homebrew or MacPorts to install (https://brew.sh)'
}
