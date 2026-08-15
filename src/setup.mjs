// The whole install, in one command.
//
// It was four: roster, warm, install-statusline, shell --install. Each one is
// still there and still does exactly what it did, because they are the things
// you reach for afterwards when only one part needs redoing. But four commands
// in order, where three of them mean nothing to someone who has just cloned
// this, is a setup step that people abandon halfway through and then report as
// broken.
//
// Checks first, because the failures worth catching are the ones that happen
// before anything has been written: no chafa, no Ghostty, wrong platform. A
// missing chafa surfaces four minutes in as a render error otherwise, which
// reads as "this project does not work" rather than "run brew install chafa".
//
// Safe to run again. Every step underneath it already is — roster skips sprites
// it has, warm skips frames it has, and both installers rewrite their own block
// rather than appending a second one.
//
// Usage: npm run setup

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { ROOT } from './config.mjs'
import { AGENTS, chosen, isStale } from './agents.mjs'

const DIM = '[2m'
const BOLD = '[1m'
const GREEN = '[32m'
const RED = '[31m'
const YELLOW = '[33m'
const RESET = '[0m'

const say = (line = '') => console.log(line)

// Every reason to stop before touching anything, gathered together so someone
// missing two of them hears about both at once rather than one per attempt.
const blockers = []
const warnings = []

if (process.platform !== 'darwin') {
  blockers.push(['this is macOS only', 'the pane is opened by driving Ghostty through AppleScript'])
}

// package.json says node >= 20, but `engines` is advice npm does not enforce
// unless it is asked to. Without this an old node reaches the sprite renderer
// and dies somewhere far from the cause, which reads as the project being
// broken rather than the runtime being too old.
const NODE_MINIMUM = 20
const nodeMajor = Number(process.versions.node.split('.')[0])

if (Number.isFinite(nodeMajor) && nodeMajor < NODE_MINIMUM) {
  blockers.push([
    `node ${process.versions.node} is too old — this needs ${NODE_MINIMUM} or newer`,
    'brew upgrade node, or nvm install --lts, then run this again',
  ])
}

if (spawnSync('chafa', ['--version'], { encoding: 'utf8' }).status !== 0) {
  // npm run deps knows the routes that do not involve Homebrew, so point at it
  // rather than repeating them here and having two places to keep right.
  blockers.push(['chafa is not installed', 'brew install chafa — or: npm run deps, which knows the other ways'])
}

// Not a blocker: everything installs fine without it, and the pane can be run
// by hand. It is only the automatic split that needs the app itself.
if (!existsSync('/Applications/Ghostty.app')) {
  warnings.push(['Ghostty is not in /Applications', 'the sprite needs it — https://ghostty.org'])
}

// zsh and bash both work — the function is plain POSIX-ish shell and runs the
// same under bash 3.2, which is what macOS ships. Anything else gets the
// warning, because the file it would be written to is a guess.
if (!/(zsh|bash)$/.test(process.env.SHELL ?? '')) {
  warnings.push([
    `your shell is ${process.env.SHELL ?? 'unknown'}, not zsh or bash`,
    'the shell wrapper will be written to ~/.zshrc, so launch flags may not load — everything typed inside a session still works',
  ])
}

// Which agents this is for, decided here so every message below can name them
// rather than assuming Claude. `--claude` / `--codex` force it; otherwise it is
// whichever binaries are actually on the machine.
const agents = chosen()

if (agents.length === 0) {
  const stale = AGENTS.filter(isStale)

  blockers.push([
    'no coding agent found',
    stale.length > 0
      ? `install Claude Code or Codex — ${stale.map((agent) => agent.dir()).join(', ')} exists, but the program does not`
      : 'install Claude Code or Codex first',
  ])
}

say()
say(`  ${BOLD}pokemanion${RESET}${DIM} — a Pokemon beside every coding session${RESET}`)
say()

if (agents.length > 0) {
  say(`  ${DIM}found:${RESET} ${agents.map((agent) => agent.label).join(', ')}`)
  say()
}

if (blockers.length > 0) {
  for (const [what, fix] of blockers) say(`  ${RED}✗${RESET} ${what}\n    ${DIM}${fix}${RESET}`)

  say()
  say(`  ${DIM}nothing was changed.${RESET}`)
  say()

  process.exit(1)
}

for (const [what, fix] of warnings) say(`  ${YELLOW}!${RESET} ${what}\n    ${DIM}${fix}${RESET}`)

if (warnings.length > 0) say()

// Kept in this order deliberately: sprites have to exist before they can be
// rendered, and both have to exist before a hook can point at them.
const steps = [
  ['downloading sprites', ['src/roster.mjs'], 'the 14 that ship with it'],
  ['rendering them for your pane', ['src/warm.mjs'], 'once, so a session starts instantly'],
  ['registering the hooks', ['install.mjs'], `into ${agents.map((agent) => `~/.${agent.name}`).join(' and ')}`],
  [`adding the ${agents.map((agent) => `${agent.name}()`).join(' and ')} wrapper`, ['src/shell.mjs', '--install'], 'for the launch flags'],
  // Without this the pane still opens — at half the window height, because the
  // keystroke that collapses it is bound to nothing. That read as a layout bug
  // for anyone but the one machine where the keybind had been added by hand.
  ['setting the Ghostty resize keybind', ['src/ghostty.mjs', '--install'], 'so the pane is a strip, not half the window'],
]

let done = 0

for (const [label, args, why] of steps) {
  process.stdout.write(`  ${DIM}${String(done + 1)}/${steps.length}${RESET} ${label}${DIM} — ${why}${RESET} `)

  const result = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' })

  if (result.status !== 0) {
    say(`${RED}✗${RESET}`)
    say()
    say(`  ${RED}stopped at: ${label}${RESET}`)

    // The step's own output, which is where the actual reason is. Indented so
    // it reads as quoted rather than as this script's own words.
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()

    if (output) {
      say()
      for (const line of output.split('\n').slice(-12)) say(`    ${DIM}${line}${RESET}`)
    }

    say()
    say(`  ${DIM}the steps before it did complete. run npm run setup again once it is fixed.${RESET}`)
    say()

    process.exit(1)
  }

  say(`${GREEN}✓${RESET}`)
  done++
}

say()
say(`  ${GREEN}installed.${RESET} three things left, and none of them is optional:`)
say()
const restart = `restart ${agents.map((agent) => agent.label).join(" and ")}`
const column = Math.max(restart.length, 'restart Ghostty'.length, 'open a new terminal'.length) + 4
const pad = (text) => text + " ".repeat(Math.max(1, column - text.length))

say(`    ${BOLD}1.${RESET} ${pad(restart)}${DIM}hooks are read at startup${RESET}`)
say(`    ${BOLD}2.${RESET} ${pad("restart Ghostty")}${DIM}it reads its config at startup${RESET}`)
say(`    ${BOLD}3.${RESET} ${pad("open a new terminal")}${DIM}or: source ~/.zshrc${RESET}`)
say()
say(`  ${DIM}and once, by hand: System Settings > Privacy & Security > Accessibility${RESET}`)
say(`  ${DIM}> enable Ghostty. Opening a split means pressing keys, and macOS will${RESET}`)
say(`  ${DIM}not let anything press keys until you allow it.${RESET}`)
say()
say(`  ${DIM}then a Pokemon appears beside your next session. it rests while the${RESET}`)
say(`  ${DIM}agent waits and animates while it works.${RESET}`)
say()
say(`  ${DIM}type${RESET} --pokemon ${DIM}at your agent to see the roster,${RESET} --random ${DIM}to be handed one,${RESET}`)
say(`  ${DIM}or${RESET} --dex pikachu ${DIM}to look one up. ${RESET}npm run doctor${DIM} if anything looks wrong.${RESET}`)
say()
