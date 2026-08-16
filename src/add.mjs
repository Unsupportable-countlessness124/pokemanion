// Add a character in one command.
//
// Everything a new resident needs is mechanical except the art: files copied in
// under the next number, an entry written into the roster, the gallery and the
// credits regenerated. Doing that by hand is four steps and six numbers, and the
// numbers drifted every single time.
//
// It also looks at what you hand it, because the same two things have gone wrong
// with every sprite tried here: art that is a smoothed upscale rather than pixel
// art, and a working half that is really a still. Neither stops the install —
// they are judgements, and the pane is the only place to make them — but you
// should hear about them before you commit the files.
//
// Usage: npm run add -- <name> <resting.gif> <working.gif>
//        npm run add -- brock ~/Downloads/front.gif ~/Downloads/side.gif

import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { ROOT } from './config.mjs'
import { ROSTER, isKnown, isResident, resolveName } from './roster.mjs'
import { decodeGif } from './gif.mjs'
import { decodePng } from './png.mjs'

const [, , rawName, restingPath, workingPath] = process.argv

const die = (message) => {
  console.log(`\n  ${message}\n`)
  process.exit(1)
}

if (!rawName || !restingPath || !workingPath) {
  die('npm run add -- <name> <resting.gif> <working.gif>')
}

const name = String(rawName).trim().toLowerCase().replace(/^--/, '')

if (!/^[a-z][a-z0-9-]*$/.test(name)) die(`"${name}" is not a name this can use — letters, digits and hyphens, starting with a letter`)
if (isResident(name)) die(`${name} is already a resident. Edit its entry in src/roster.mjs instead.`)

for (const path of [restingPath, workingPath]) {
  if (!existsSync(path)) die(`no such file: ${path}`)
}

// What the art is, before anything is copied anywhere.
//
// Both numbers here have decided real arguments. Few frames means the working
// half cannot move, and every attempt to make a still move — a growing water
// jet, two poses alternating — has been reverted.
//
// The other is scale. Art drawn at its own size has runs of one pixel because
// that is what pixel art is; art blown up cleanly has runs of the upscale
// factor, which `recoverNative` divides back out. Runs of one in a *large*
// image is the bad case: it was resampled, there is no grid to recover, and it
// will read soft beside sprites that snap to the terminal's cells. So the test
// is runs of one at a size no one draws at.
const look = (path) => {
  const bytes = readFileSync(path)
  const image = extname(path).toLowerCase() === '.png' ? decodePng(bytes) : decodeGif(bytes)
  const { width, height, frames } = image
  const [{ pixels }] = frames
  const key = (x, y) => {
    const i = (y * width + x) * 4

    return pixels[i + 3] < 128 ? -1 : (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]
  }

  const runs = new Map()

  for (let y = 0; y < height; y += 2) {
    let start = 0

    for (let x = 1; x <= width; x++) {
      if (x === width || key(x, y) !== key(x - 1, y)) {
        runs.set(x - start, (runs.get(x - start) ?? 0) + 1)
        start = x
      }
    }
  }

  const [modal] = [...runs.entries()].sort((a, b) => b[1] - a[1])[0] ?? [1]

  return { width, height, frames: frames.length, modal }
}

const resting = look(restingPath)
const working = look(workingPath)

console.log(`\n  ${name}`)
console.log(`    resting  ${resting.width}x${resting.height}, ${resting.frames} frames`)
console.log(`    working  ${working.width}x${working.height}, ${working.frames} frames`)

const notes = []

if (working.frames < 4) notes.push(`the working half has ${working.frames} frame${working.frames === 1 ? '' : 's'} — it will barely move`)
// Gen-5 sprites are 96px at the largest, so anything past 150 was scaled up by
// somebody.
const NATIVE = 150
const soft = (art) => art.modal === 1 && Math.max(art.width, art.height) > NATIVE

if (soft(resting)) notes.push('the resting art was resampled rather than upscaled cleanly — no pixel grid to recover, so it will read soft at pane size')
if (soft(working)) notes.push('the working art was resampled rather than upscaled cleanly — no pixel grid to recover, so it will read soft at pane size')

if (notes.length > 0) {
  console.log('\n  worth knowing:')

  for (const note of notes) console.log(`    - ${note}`)
}

// The next free number, so files sort in the order they arrived.
const used = readdirSync(join(ROOT, 'assets'))
  .map((file) => Number.parseInt(file, 10))
  .filter((n) => Number.isFinite(n))

const next = Math.max(0, ...used) + 1
const restFile = `${next}-${name}-resting${extname(restingPath).toLowerCase()}`
const workFile = `${next + 1}-${name}-working${extname(workingPath).toLowerCase()}`

copyFileSync(restingPath, join(ROOT, 'assets', restFile))
copyFileSync(workingPath, join(ROOT, 'assets', workFile))

// A card is what a resident who is not a Pokemon needs — the pokedex is built
// from Showdown's data and has no people in it, so without one `--dex brock`
// has nothing to answer with.
const pokemon = Boolean(resolveName(name) && isKnown(name))
const title = name[0].toUpperCase() + name.slice(1)

const entry = pokemon
  ? `  { name: '${name}', idle: 'assets/${restFile}', busy: 'assets/${workFile}', busySpeed: 1 },`
  : `  {
    name: '${name}',
    idle: 'assets/${restFile}',
    busy: 'assets/${workFile}',
    busySpeed: 1,
    card: {
      title: '${title}',
      blurb: '',
      facts: [['species', 'Human']],
      pane: ['${title}'],
    },
  },`

const rosterPath = join(ROOT, 'src', 'roster.mjs')
const roster = readFileSync(rosterPath, 'utf8')
const opens = roster.indexOf('export const ROSTER = [')

if (opens === -1) die('cannot find `export const ROSTER = [` in src/roster.mjs')

const closes = roster.indexOf('\n]', opens)

if (closes === -1) die('cannot find the end of the ROSTER array in src/roster.mjs')

writeFileSync(rosterPath, `${roster.slice(0, closes)}\n${entry}${roster.slice(closes)}`)

// The rest of the wiring, rather than a list of commands to go and type. Both
// of these read the roster and rewrite what they own — the README gallery and
// its counts, and the credits table — so there is nothing to remember.
const { spawnSync } = await import('node:child_process')

for (const script of ['gallery.mjs', 'attribution.mjs']) {
  const run = spawnSync(process.execPath, [join(ROOT, 'src', script)], { encoding: 'utf8' })

  if (run.status !== 0) die(`${script} failed: ${(run.stderr || run.stdout || '').trim().split('\n')[0]}`)
}

// Staged, not committed. The suite checks that every resident's sprite is in
// the repository, and a file sitting untracked in assets/ fails that — which is
// a confusing way to learn you forgot `git add` on art you just installed.
spawnSync('git', ['add', join('assets', restFile), join('assets', workFile)], { cwd: ROOT })

console.log(`\n  assets/${restFile}`)
console.log(`  assets/${workFile}`)
console.log(`  src/roster.mjs — entry added, ${ROSTER.length + 1} residents`)
console.log('  README.md — gallery and counts')
console.log('  ATTRIBUTION.md — credits')

if (!pokemon) {
  console.log(`\n  ${title} is not a Pokemon, so a card was written for the pokedex.`)
  console.log('  Fill in its `blurb` and `pane` lines in src/roster.mjs — --dex reads them.')
}

console.log('\n  A pane already open will not have it: that process was started before')
console.log('  the entry existed. Open a new session.\n')
