// Put the skill where an agent will find it, for a source install.
//
// The plugin ships `skills/` and both agents load it from there. A clone has the
// same file and no way to offer it, so this links it into ~/.claude/skills,
// which Claude Code loads on the next session.
//
// Linked rather than copied: the point of a clone is that you are editing this
// project, and a copy would go stale the moment you improved the skill.
//
// Usage: npm run skill -- --install
//        npm run skill -- --remove
//        npm run skill

import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ROOT } from './config.mjs'

const NAME = 'adding-a-character'
const source = join(ROOT, 'skills', NAME)
const home = join(homedir(), '.claude', 'skills')
const target = join(home, NAME)

const linked = () => {
  try {
    return lstatSync(target).isSymbolicLink() ? readlinkSync(target) : target
  } catch {
    return null
  }
}

const where = linked()

if (process.argv.includes('--remove')) {
  if (!where) console.log(`\n  nothing at ${target}\n`)
  else {
    rmSync(target, { recursive: true, force: true })
    console.log(`\n  removed ${target}\n  open a new session\n`)
  }
} else if (process.argv.includes('--install')) {
  if (!existsSync(source)) {
    console.log(`\n  no skill at ${source}\n`)
    process.exit(1)
  }

  if (where === source) console.log(`\n  already linked: ${target}\n`)
  else {
    mkdirSync(home, { recursive: true })
    rmSync(target, { recursive: true, force: true })
    symlinkSync(source, target)
    console.log(`\n  ${target}\n    -> ${source}\n\n  open a new session and your agent knows how to add a character\n`)
  }
} else {
  console.log(`\n  ${where === source ? 'installed' : where ? `something else is at ${target}` : 'not installed'}`)
  console.log('\n  npm run skill -- --install    teach this machine\'s Claude the toolbox')
  console.log('  npm run skill -- --remove     take it back out\n')
}
