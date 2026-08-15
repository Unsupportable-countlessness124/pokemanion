// Installs the two things this needs that are not Node: chafa and Ghostty.
//
// Separate from `npm run setup` on purpose. Setup edits config files you own
// and can undo; this installs software, and Ghostty is a whole terminal
// emulator. Downloading an application because someone ran a setup script is
// not a thing to do quietly, so setup checks and names what is missing, and
// this is what you run when you want it done for you.
//
// It will not install a package manager for you. Homebrew's installer wants a
// password, writes to /opt, edits your shell profile and does not put `brew` on
// the PATH of the shell that ran it — a chain of things to go wrong in the
// middle of someone else's install script, to set up software they did not ask
// for. If neither Homebrew nor MacPorts is here, this says what to do instead
// and stops. Both tools have a route that needs no package manager at all.
//
// Usage: npm run deps          — install what is missing
//        npm run deps -- --dry — say what it would do

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const YELLOW = '\x1b[33m'
const RESET = '\x1b[0m'

const dry = process.argv.includes('--dry')
const say = (line = '') => console.log(line)

const have = (command) => spawnSync('command', ['-v', command], { shell: true, encoding: 'utf8' }).status === 0

// Homebrew first because it has both, MacPorts second because it has chafa.
// Checked once here rather than per tool, so the report below can say which one
// it is going to use.
const manager = have('brew') ? 'brew' : have('port') ? 'port' : null

const GHOSTTY_APP = '/Applications/Ghostty.app'

const NEEDED = [
  {
    name: 'chafa',
    why: 'turns the sprites into terminal graphics',
    present: () => have('chafa'),
    // MacPorts ships it too, which is worth knowing: without it the only route
    // is building from source, since there is no prebuilt macOS binary.
    command: () =>
      manager === 'brew' ? ['brew', ['install', 'chafa']] : manager === 'port' ? ['sudo', ['port', 'install', 'chafa']] : null,
    without: [
      'MacPorts:     sudo port install chafa',
      'from source:  https://hpjansson.org/chafa/download/',
      `${DIM}there is no prebuilt macOS binary, so one of those two it is${RESET}`,
    ],
  },
  {
    name: 'Ghostty',
    why: 'the terminal the pane opens in',
    present: () => existsSync(GHOSTTY_APP),
    // Not in MacPorts — it is a GUI app, and the project ships its own build.
    command: () => (manager === 'brew' ? ['brew', ['install', '--cask', 'ghostty']] : null),
    without: [
      'download the .dmg:  https://ghostty.org/download',
      `${DIM}a universal build, macOS 13+, no package manager needed${RESET}`,
    ],
  },
]

say()

if (process.platform !== 'darwin') {
  say(`  ${RED}macOS only${RESET}\n`)
  process.exit(1)
}

const missing = NEEDED.filter((item) => !item.present())

for (const item of NEEDED.filter((entry) => entry.present())) {
  say(`  ${GREEN}✓${RESET} ${item.name}${DIM} — already installed${RESET}`)
}

if (missing.length === 0) {
  say(`\n  ${DIM}nothing to do. run npm run setup next.${RESET}\n`)
  process.exit(0)
}

// Anything this cannot install here, with the route that needs no package
// manager. Printed before the installs so someone reading a wall of brew output
// does not miss it.
const unhandled = missing.filter((item) => item.command() === null)

if (unhandled.length > 0) {
  if (!manager) {
    say(`  ${YELLOW}no Homebrew or MacPorts here${RESET}${DIM} — and this will not install one for you${RESET}`)
    say(`  ${DIM}https://brew.sh if you want one. Otherwise, per tool:${RESET}`)
  }

  for (const item of unhandled) {
    say()
    say(`  ${BOLD}${item.name}${RESET}${DIM} — ${item.why}${RESET}`)

    for (const line of item.without) say(`    ${line}`)
  }

  say()
}

const installable = missing.filter((item) => item.command() !== null)

for (const item of installable) {
  const [command, args] = item.command()

  if (dry) {
    say(`  ${DIM}would run:${RESET} ${command} ${args.join(' ')}${DIM} — ${item.why}${RESET}`)

    continue
  }

  say(`  installing ${item.name}${DIM} — ${item.why}${RESET}`)

  // Inherited, because these ask for a password and print progress worth
  // watching. Swallowing that output would look like a hang.
  const result = spawnSync(command, args, { stdio: 'inherit' })

  if (result.status !== 0) {
    say(`\n  ${RED}${command} ${args.join(' ')} failed${RESET}`)
    say(`  ${DIM}install ${item.name} yourself, then run npm run setup${RESET}\n`)
    process.exit(1)
  }
}

if (dry) {
  say(`\n  ${DIM}--dry, so nothing was installed${RESET}\n`)
  process.exit(0)
}

const stillMissing = NEEDED.filter((item) => !item.present())

say()

if (stillMissing.length > 0) {
  say(`  ${YELLOW}still missing: ${stillMissing.map((item) => item.name).join(', ')}${RESET}`)
  say(`  ${DIM}install those, then run npm run setup${RESET}\n`)
  process.exit(1)
}

say(`  ${GREEN}both installed.${RESET} now run: npm run setup\n`)
