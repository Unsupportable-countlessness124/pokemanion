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
// It prepares the art as well as installing it. Two GIFs that are already two
// animations need nothing, but the useful ones rarely are: a sheet holds four
// directions in one file, and half the sprites worth having sit on a white card.
// So it can take a range of frames out of a file, and it lifts a flat background
// off whatever it is given.
//
// Usage: npm run add -- <name> <resting.gif> <working.gif>
//        npm run add -- brock sheet.gif sheet.gif --resting=0-8 --working=12-17

import { copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { ROOT } from './config.mjs'
import { ROSTER, isKnown, isResident, resolveName } from './roster.mjs'
import { decodeGif } from './gif.mjs'
import { decodePng } from './png.mjs'
import { encodeGif } from './gifwrite.mjs'

const args = process.argv.slice(2)
const flag = (key) => {
  const found = args.find((arg) => arg.startsWith(`--${key}=`))

  return found ? found.slice(key.length + 3) : null
}

const range = (key) => {
  const value = flag(key)

  if (!value) return null

  const [from, to] = value.split('-').map(Number)

  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) die(`--${key}=${value} is not a range like 0-8`)

  return [from, to]
}

const [rawName, restingPath, workingPath] = args.filter((arg) => !arg.startsWith('--'))

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
if ((soft(resting) || soft(working)) && !args.includes('--halo')) {
  notes.push('resampled art usually carries a pale halo the background fill cannot reach — add --halo to take it off, unless the sprite has white in it')
}

if (notes.length > 0) {
  console.log('\n  worth knowing:')

  for (const note of notes) console.log(`    - ${note}`)
}

// The next free number, so files sort in the order they arrived.
const used = readdirSync(join(ROOT, 'assets'))
  .map((file) => Number.parseInt(file, 10))
  .filter((n) => Number.isFinite(n))

const next = Math.max(0, ...used) + 1

// Preparing the art, which is the part that used to be done by hand.
//
// Three things, in the order that makes each one easier: take the frames asked
// for, lift the background off them, then crop to whatever is left. Cropping
// last matters — crop first and the box is the size of the card, not of the
// figure.
const prepare = (path, keep) => {
  const bytes = readFileSync(path)
  const png = extname(path).toLowerCase() === '.png'
  const image = png ? decodePng(bytes) : decodeGif(bytes)
  const { width, height } = image
  const frames = keep ? image.frames.slice(keep[0], keep[1] + 1) : image.frames

  if (frames.length === 0) die(`${path} has ${image.frames.length} frames, so ${keep[0]}-${keep[1]} selects none`)

  // What the background is: the commonest opaque colour around the border. A
  // sprite touching every edge has none, and then nothing is keyed.
  const edge = new Map()

  for (const { pixels } of frames.slice(0, 1)) {
    const sample = (x, y) => {
      const i = (y * width + x) * 4

      if (pixels[i + 3] < 128) return

      const key = `${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`

      edge.set(key, (edge.get(key) ?? 0) + 1)
    }

    for (let x = 0; x < width; x++) { sample(x, 0); sample(x, height - 1) }
    for (let y = 0; y < height; y++) { sample(0, y); sample(width - 1, y) }
  }

  const [common] = [...edge.entries()].sort((a, b) => b[1] - a[1])[0] ?? []
  const border = 2 * (width + height)
  const card = common && (edge.get(common) ?? 0) > border * 0.3 ? common.split(',').map(Number) : null

  // Flood filled from the edge rather than matched by colour, so a white card
  // goes and a white shirt stays. The tolerance takes the soft edge an upscale
  // leaves between the two.
  const clear = (pixels) => {
    if (!card) return pixels

    const out = new Uint8Array(pixels)
    const seen = new Uint8Array(width * height)
    const queue = []
    const near = (i) => {
      if (out[i + 3] < 128) return true

      const d = Math.abs(out[i] - card[0]) + Math.abs(out[i + 1] - card[1]) + Math.abs(out[i + 2] - card[2])

      return d < 90
    }

    for (let x = 0; x < width; x++) queue.push([x, 0], [x, height - 1])
    for (let y = 0; y < height; y++) queue.push([0, y], [width - 1, y])

    while (queue.length) {
      const [x, y] = queue.pop()

      if (x < 0 || y < 0 || x >= width || y >= height) continue

      const at = y * width + x

      if (seen[at] || !near(at * 4)) continue

      seen[at] = 1
      out[at * 4 + 3] = 0
      queue.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
    }

    return out
  }

  // Pockets the fill cannot reach: the gaps between hair spikes, ringed by
  // figure on every side. They are background to the eye and unreachable to a
  // flood fill, and the only thing separating them from a sprite's white eyes
  // is that they match the card. So this is asked for rather than assumed —
  // `--halo` — because eating a Pokemon's eyes is worse than leaving specks.
  const halo = args.includes('--halo')
  const pockets = (pixels) => {
    if (!halo || !card) return pixels

    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] < 128) continue

      const max = Math.max(pixels[i], pixels[i + 1], pixels[i + 2])
      const min = Math.min(pixels[i], pixels[i + 1], pixels[i + 2])

      if (max > 170 && max - min < 26) pixels[i + 3] = 0
    }

    return pixels
  }

  const keyed = frames.map((frame) => pockets(clear(frame.pixels)))

  // One box for every frame, so the figure does not jump between them.
  let x0 = 1e9
  let y0 = 1e9
  let x1 = -1
  let y1 = -1

  for (const pixels of keyed) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (pixels[(y * width + x) * 4 + 3] < 128) continue

        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }

  if (x1 < 0) die(`${path} is empty once its background is taken off`)

  const W = x1 - x0 + 1
  const H = y1 - y0 + 1
  const cropped = keyed.map((pixels) => {
    const out = new Uint8Array(W * H * 4)

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const from = ((y0 + y) * width + (x0 + x)) * 4
        const to = (y * W + x) * 4

        for (let c = 0; c < 4; c++) out[to + c] = pixels[from + c]
      }
    }

    return out
  })

  const touched = Boolean(keep) || Boolean(card) || W !== width || H !== height

  return { frames: cropped, width: W, height: H, delay: frames[0].delay || 100, touched }
}

const restPrepared = prepare(restingPath, range('resting'))
const workPrepared = prepare(workingPath, range('working'))

const restFile = `${next}-${name}-resting${restPrepared.touched ? '.gif' : extname(restingPath).toLowerCase()}`
const workFile = `${next + 1}-${name}-working${workPrepared.touched ? '.gif' : extname(workingPath).toLowerCase()}`

if (restPrepared.touched) {
  writeFileSync(join(ROOT, 'assets', restFile), encodeGif(restPrepared.frames, restPrepared.width, restPrepared.height, restPrepared.delay))
} else copyFileSync(restingPath, join(ROOT, 'assets', restFile))

if (workPrepared.touched) {
  writeFileSync(join(ROOT, 'assets', workFile), encodeGif(workPrepared.frames, workPrepared.width, workPrepared.height, workPrepared.delay))
} else copyFileSync(workingPath, join(ROOT, 'assets', workFile))

if (restPrepared.touched || workPrepared.touched) {
  console.log('\n  prepared:')

  if (restPrepared.touched) console.log(`    resting  ${restPrepared.frames.length} frames, ${restPrepared.width}x${restPrepared.height}`)
  if (workPrepared.touched) console.log(`    working  ${workPrepared.frames.length} frames, ${workPrepared.width}x${workPrepared.height}`)
}

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
