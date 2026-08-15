// Pre-renders every roster sprite into the frame cache.
//
// Converting a sprite means writing a PNG and launching chafa per frame, and a
// Gen-5 animation runs to sixty of them. Paying that when a session starts is
// half a second of empty pane; paying it here means the pane is drawn as fast
// as the process can start.
//
// Usage: npm run warm [rows]

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { ROOT, loadConfig } from './config.mjs'
import { ROSTER, available, busyFile, idleFile } from './roster.mjs'

const config = loadConfig()
const rows = Number(process.argv[2]) || config.windowRows || 4

console.log(`\n  warming the cache for ${rows}-row panes\n`)

let total = 0

for (const name of available()) {
  const started = Date.now()

  // Rendering is what fills the cache, so the cheapest way to warm it is to run
  // the real thing and stop it once it has drawn.
  const result = spawnSync(
    process.execPath,
    [join(ROOT, 'src', 'window.mjs'), String(rows), `--species=${name}`, '--session=warm'],
    { timeout: 30_000, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )

  const took = Date.now() - started

  total += took

  console.log(
    `  ${name.padEnd(12)} ${String(took).padStart(5)}ms` +
      (result.error && result.error.code !== 'ETIMEDOUT' ? `  ${result.error.message}` : ''),
  )
}

console.log(`\n  ${available().length} species, ${(total / 1000).toFixed(1)}s total. Sessions now start warm.\n`)
