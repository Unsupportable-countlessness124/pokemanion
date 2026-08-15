// The one Ghostty setting the pane needs, written into ~/.config/ghostty/config.
//
// `openSplit` collapses the new split down to a strip by pressing a resize
// key. Ghostty's built-in resize step is ten pixels, so collapsing a
// half-height split that way takes over a hundred presses — slow enough that
// you watch it crawl down the screen. One press of a 2000px step does the same
// job instantly.
//
// That keybind is not built in. It has to be in the user's own Ghostty config,
// and until now nothing put it there: the machine this was developed on had it
// added by hand, with a comment claiming this project had done it. Anyone else
// pressed a chord bound to nothing, the pane was never squashed, and the sprite
// arrived in a split taking half the window instead of a four-row strip. It
// looked like a layout bug rather than a missing line of config.
//
// Ghostty reads its config at startup, so it takes a restart of Ghostty — not
// of the pane, and not of Claude.
//
// Usage: npm run ghostty -- --install   (or --remove)

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const CONFIG = join(homedir(), '.config', 'ghostty', 'config')

const BEGIN = '# >>> pokemanion >>>'
const END = '# <<< pokemanion <<<'

// What the keystroke in openSplit is bound to. `key code 125` is the down
// arrow, with command+control+shift — super+ctrl+shift+arrow_down here.
export const KEYBINDS = [
  'keybind = super+ctrl+shift+arrow_down=resize_split:down,2000',
  'keybind = super+ctrl+shift+arrow_up=resize_split:up,2000',
]

export const snippet = () =>
  `${BEGIN}
# Ghostty's built-in resize step is ten pixels, so collapsing a half-height
# split down to a strip takes over a hundred keypresses. This does it in one.
#
# Remove with: npm run ghostty -- --remove
${KEYBINDS.join('\n')}
${END}`

const readConfig = () => {
  try {
    return readFileSync(CONFIG, 'utf8')
  } catch {
    return ''
  }
}

// Two ways it can already be there. Our own block, which is easy — and the
// hand-written version that predates this file, on the machine where it was
// added manually. Matching the keybind itself catches both, so nobody ends up
// with the same binding declared twice.
export const alreadyBound = (text = readConfig()) =>
  KEYBINDS.every((line) => text.includes(line.replace('keybind = ', '').trim()))

const withoutOurs = (text) => {
  const from = text.indexOf(BEGIN)

  if (from === -1) return text

  const to = text.indexOf(END, from)

  if (to === -1) return text

  return `${text.slice(0, from)}${text.slice(to + END.length)}`.replace(/\n{3,}/g, '\n\n')
}

export const install = () => {
  const text = readConfig()

  // Already bound by hand, and not by us. Left exactly as it is: it does the
  // job, and a second identical keybind in a config file is the kind of thing
  // someone finds a year later and cannot explain.
  if (alreadyBound(text) && !text.includes(BEGIN)) return 'already bound'

  mkdirSync(dirname(CONFIG), { recursive: true })

  if (existsSync(CONFIG) && !existsSync(`${CONFIG}.pokemanion-backup`)) {
    copyFileSync(CONFIG, `${CONFIG}.pokemanion-backup`)
  }

  const body = withoutOurs(text).trimEnd()

  writeFileSync(CONFIG, `${body ? `${body}\n\n` : ''}${snippet()}\n`)

  return text.includes(BEGIN) ? 'updated' : 'added'
}

export const remove = () => {
  const text = readConfig()

  if (!text.includes(BEGIN)) return 'nothing of ours to remove'

  writeFileSync(CONFIG, `${withoutOurs(text).trimEnd()}\n`)

  return 'removed'
}

if (process.argv[1] && process.argv[1].endsWith('ghostty.mjs')) {
  if (process.argv.includes('--remove')) {
    console.log(`\n  ${remove()} — ${CONFIG}\n  restart Ghostty\n`)
  } else if (process.argv.includes('--install')) {
    console.log(`\n  ${install()} — ${CONFIG}\n  restart Ghostty for it to take effect\n`)
  } else {
    console.log(`\n  ${alreadyBound() ? 'the resize keybind is set' : 'not set — npm run ghostty -- --install'}\n`)
  }
}
