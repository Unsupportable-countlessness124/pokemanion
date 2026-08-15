// Installs the two things this needs that are not Node: chafa and Ghostty.
//
// Separate from `npm run setup` on purpose. Setup edits config files you own
// and can undo; this installs software, and Ghostty is a whole terminal
// emulator. Downloading an application because someone ran a setup script is
// not a thing to do quietly, so setup checks and names what is missing, and
// this is what you run when you want it done for you.
//
// Homebrew only, because that is how both are distributed on macOS and this is
// a macOS-only project. Anything already present is left alone.
//
// Usage: npm run deps          — install what is missing
//        npm run deps -- --dry — say what it would do

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const DIM = '\x1b[2m'
const GREEN = '\x1b[32m'
const RED = '\x1b[31m'
const RESET = '\x1b[0m'

const dry = process.argv.includes('--dry')

const have = (command) => spawnSync('command', ['-v', command], { shell: true, encoding: 'utf8' }).status === 0

const NEEDED = [
  {
    name: 'chafa',
    // The renderer. Nothing draws without it.
    present: () => have('chafa'),
    install: ['brew', ['install', 'chafa']],
    why: 'turns the sprites into terminal graphics',
  },
  {
    name: 'Ghostty',
    present: () => existsSync('/Applications/Ghostty.app'),
    install: ['brew', ['install', '--cask', 'ghostty']],
    why: 'the terminal the pane opens in',
  },
]

console.log()

if (process.platform !== 'darwin') {
  console.log(`  ${RED}macOS only${RESET}\n`)
  process.exit(1)
}

if (!have('brew')) {
  console.log(`  ${RED}Homebrew is not installed${RESET}`)
  console.log(`  ${DIM}https://brew.sh — then run this again${RESET}\n`)
  process.exit(1)
}

const missing = NEEDED.filter((item) => !item.present())

for (const item of NEEDED.filter((entry) => entry.present())) {
  console.log(`  ${GREEN}✓${RESET} ${item.name}${DIM} — already installed${RESET}`)
}

if (missing.length === 0) {
  console.log(`\n  ${DIM}nothing to do. run npm run setup next.${RESET}\n`)
  process.exit(0)
}

for (const item of missing) {
  const [command, args] = item.install

  if (dry) {
    console.log(`  ${DIM}would run:${RESET} ${command} ${args.join(' ')}${DIM} — ${item.why}${RESET}`)

    continue
  }

  console.log(`\n  installing ${item.name}${DIM} — ${item.why}${RESET}`)

  // Inherited, because brew asks for a password for casks and prints progress
  // worth watching. Swallowing that output would look like a hang.
  const result = spawnSync(command, args, { stdio: 'inherit' })

  if (result.status !== 0) {
    console.log(`\n  ${RED}${command} ${args.join(' ')} failed${RESET}`)
    console.log(`  ${DIM}install ${item.name} yourself, then run npm run setup${RESET}\n`)
    process.exit(1)
  }
}

console.log()

if (dry) {
  console.log(`  ${DIM}--dry, so nothing was installed${RESET}\n`)
  process.exit(0)
}

const stillMissing = NEEDED.filter((item) => !item.present())

if (stillMissing.length > 0) {
  console.log(`  ${RED}still missing: ${stillMissing.map((item) => item.name).join(', ')}${RESET}\n`)
  process.exit(1)
}

console.log(`  ${GREEN}both installed.${RESET} now run: npm run setup\n`)
