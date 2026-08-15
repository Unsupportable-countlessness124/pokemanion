// Measures the shape of a character cell in your terminal, by eye.
//
// Everything the renderer does rests on knowing how much taller a cell is than
// it is wide. Two is the usual answer and it is why ▀ works — it cuts the cell
// into two squares. Extra line spacing makes cells taller, the halves stop
// being square, and every sprite comes out stretched.
//
// There is no way to ask the terminal, so: print squares drawn for several
// assumptions and see which one actually looks square.

const RESET = '\x1b[0m'
const BLOCK = '\x1b[48;2;247;208;44m'
const DIM = '\x1b[2m'

const ROWS = 8

console.log(`\n  Which of these looks like an actual square?\n`)

for (const aspect of [1.6, 1.8, 2.0, 2.2, 2.4]) {
  // A block ROWS tall needs ROWS * aspect columns to come out square.
  const cols = Math.round(ROWS * aspect)

  console.log(`  cellAspect ${aspect.toFixed(1)}  (${cols} wide x ${ROWS} tall)`)

  for (let y = 0; y < ROWS; y++) {
    console.log(`    ${BLOCK}${' '.repeat(cols)}${RESET}`)
  }

  console.log('')
}

console.log(`  ${DIM}Put the winner in config.json as "cellAspect", then: npm run build${RESET}`)
console.log(`  ${DIM}Too wide a value squashes the sprite; too narrow stretches it.${RESET}\n`)
