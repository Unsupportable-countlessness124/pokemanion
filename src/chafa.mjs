// Rendering frames with chafa instead of the built-in renderer.
//
// The built-in one picks a colour per block and hopes. Chafa searches for the
// glyph and pair of colours that best reproduce the actual pixels, and it knows
// the octant characters, which are 8 pixels to a cell against the 2 a half
// block manages. It only reads image files, so frames go out through pngwrite.
//
// Everything before this still matters: chafa will not recover a sprite's real
// resolution, and it will not knock out a painted-in background.

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodePng } from './pngwrite.mjs'

// Cursor show/hide wrap the output and would leak into the status line.
const CURSOR = /\x1b\[\?25[lh]/g

export const hasChafa = () => {
  const probe = spawnSync('chafa', ['--version'], { encoding: 'utf8' })

  return probe.status === 0
}

// How many pixels a cell holds, so the sprite can be asked for at a size that
// divides cleanly rather than being stretched to fit.
export const CHAFA_CELL = {
  octant: { width: 2, height: 4 },
  sextant: { width: 2, height: 3 },
  quad: { width: 2, height: 2 },
  half: { width: 1, height: 2 },
  vhalf: { width: 2, height: 1 },
  braille: { width: 2, height: 4 },
  block: { width: 1, height: 2 },
  all: { width: 2, height: 4 },
}

export const renderWithChafa = ({ frames, width, height }, { cols, rows, symbols = 'octant' }) => {
  const dir = mkdtempSync(join(tmpdir(), 'pixel-runner-'))

  try {
    return frames.map(({ pixels, delay }, index) => {
      const file = join(dir, `frame-${index}.png`)

      writeFileSync(file, encodePng(pixels, width, height))

      const result = spawnSync(
        'chafa',
        [
          '--format', 'symbols',
          '--symbols', symbols,
          '--size', `${cols}x${rows}`,
          '--colors', 'full',
          '--animate', 'off',
          '--polite', 'on',
          '--relative', 'off',
          '--margin-bottom', '0',
          '--margin-right', '0',
          file,
        ],
        { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      )

      if (result.status !== 0) {
        throw new Error(`chafa failed: ${(result.stderr ?? '').trim() || result.status}`)
      }

      const lines = result.stdout
        .replace(CURSOR, '')
        .split('\n')
        .filter((line) => line.trim() !== '')

      // chafa leaves the last cell's colours set; close every row so the status
      // line's own text is not painted in Pikachu yellow.
      return { delay, rows: lines.map((line) => `${line}\x1b[0m`) }
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
