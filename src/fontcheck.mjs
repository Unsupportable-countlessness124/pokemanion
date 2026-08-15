// Not every font has every block-drawing glyph. If your terminal shows an empty
// box for a row below, that style will not work for you — pick one that renders.

const FAMILIES = [
  ['half     (2 px per cell)', '▀▄█ ', 'in every font'],
  ['quad     (4 px per cell)', '▘▝▖▗▚▞▛▜▙▟', 'in almost every font'],
  ['sextant  (6 px per cell)', '\u{1FB00}\u{1FB01}\u{1FB0E}\u{1FB1F}\u{1FB2A}\u{1FB37}', 'needs Symbols for Legacy Computing'],
  ['braille  (8 px per cell)', '⠁⠉⠛⣿⣤⡿', 'in every font, but dotted'],
]

console.log('\n  Does your terminal font have these?\n')

for (const [name, glyphs, note] of FAMILIES) {
  console.log(`  ${name}   ${glyphs}   ${note}`)
}

console.log(`
  A row of identical empty rectangles means the font is missing that family.
  Set the ones that render as "style" in config.json, then: npm run build
`)
