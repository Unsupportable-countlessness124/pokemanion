// Packing more than two pixels into one character cell.
//
// The half block ▀ splits a cell in two, which is why the sprite has only twice
// as many pixels vertically as it has rows. Unicode subdivides much further:
// quadrants cut a cell into 2x2, sextants into 2x3, braille into 2x4. Same rows
// on screen, up to four times the detail.
//
// The price is colour. A cell is one glyph with one foreground and one
// background, so however many pixels it holds, only two colours can appear in
// it. Each cell therefore picks the two colours that fit its own pixels best and
// then the glyph whose filled pattern matches which pixels wanted which colour.
// Sprites are drawn in flat colour, so most cells sit inside one region and the
// approximation costs nothing.

const TRANSPARENT = -1

// bit 0 is the top-left pixel, then left to right, top to bottom.
const QUADRANTS = [
  ' ', '▘', '▝', '▀',
  '▖', '▌', '▞', '▛',
  '▗', '▚', '▐', '▜',
  '▄', '▙', '▟', '█',
]

// Sextants live at U+1FB00 apart from the four patterns that already had
// characters elsewhere: empty, full, and the two solid half-width columns.
const SEXTANT_EXCEPTIONS = { 0: ' ', 21: '▌', 42: '▐', 63: '█' }

const sextant = (bits) => {
  const exception = SEXTANT_EXCEPTIONS[bits]

  if (exception) return exception

  const offset = bits - 1 - (bits > 21 ? 1 : 0) - (bits > 42 ? 1 : 0)

  return String.fromCodePoint(0x1fb00 + offset)
}

// Octants are 2x4 and live at U+1CD00, but only 230 of the 256 patterns are
// there: the other 26 already had characters elsewhere and Unicode does not
// encode anything twice. Those 26 are listed here, and the rest follow in order
// from U+1CD00, so a codepoint is its pattern's rank among the ones that were
// not already taken.
//
// Verified against UnicodeData.txt — the BLOCK OCTANT-nnn names spell out which
// of the eight cells each character fills, which is what makes this checkable
// rather than guesswork.
const OCTANT_ELSEWHERE = {
  0: ' ',
  1: '\u{1CEA8}', // left half upper one quarter
  2: '\u{1CEAB}', // right half upper one quarter
  3: '\u{1FB82}', // upper one quarter
  5: '▘',
  10: '▝',
  15: '▀',
  20: '\u{1FBE6}', // middle left one quarter
  40: '\u{1FBE7}', // middle right one quarter
  63: '\u{1FB85}', // upper three quarters
  64: '\u{1CEA3}', // left half lower one quarter
  80: '▖',
  85: '▌',
  90: '▞',
  95: '▛',
  128: '\u{1CEA0}', // right half lower one quarter
  160: '▗',
  165: '▚',
  170: '▐',
  175: '▜',
  192: '▂', // lower one quarter
  240: '▄',
  245: '▙',
  250: '▟',
  252: '▆', // lower three quarters
  255: '█',
}

const OCTANTS = Array.from({ length: 256 }, (unused, pattern) => {
  const existing = OCTANT_ELSEWHERE[pattern]

  if (existing) return existing

  let rank = 0

  for (let i = 0; i < pattern; i++) {
    if (!(i in OCTANT_ELSEWHERE)) rank++
  }

  return String.fromCodePoint(0x1cd00 + rank)
})

// Braille numbers its dots down the left column then down the right, with the
// fourth row tacked on the end — hence the jump to 0x40 and 0x80.
const BRAILLE_BITS = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
]

export const CELL_SHAPES = {
  half: { width: 1, height: 2 },
  octant: { width: 2, height: 4 },
  quad: { width: 2, height: 2 },
  sextant: { width: 2, height: 3 },
  braille: { width: 2, height: 4 },
}

const glyphFor = (style, bits) => {
  if (style === 'quad') return QUADRANTS[bits]
  if (style === 'octant') return OCTANTS[bits]
  if (style === 'sextant') return sextant(bits)

  return String.fromCodePoint(0x2800 + bits)
}

const bitFor = (style, x, y, width) => {
  if (style === 'braille') return BRAILLE_BITS[x][y]

  return 1 << (y * width + x)
}

const key = (pixels, index) =>
  pixels[index + 3] < 128 ? TRANSPARENT : (pixels[index] << 16) | (pixels[index + 1] << 8) | pixels[index + 2]

const distance = (a, b) => {
  if (a === TRANSPARENT || b === TRANSPARENT) return a === b ? 0 : Infinity

  const dr = ((a >> 16) & 255) - ((b >> 16) & 255)
  const dg = ((a >> 8) & 255) - ((b >> 8) & 255)
  const db = (a & 255) - (b & 255)

  return dr * dr + dg * dg + db * db
}

const ansi = (colour, background) => {
  if (colour === TRANSPARENT) return background ? '\x1b[49m' : '\x1b[39m'

  const r = (colour >> 16) & 255
  const g = (colour >> 8) & 255
  const b = colour & 255

  return `\x1b[${background ? 48 : 38};2;${r};${g};${b}m`
}

// Two colours for a cell whose pixels are all opaque, chosen by trying every
// way of splitting them and keeping the one that reproduces the cell best.
//
// Taking the two commonest colours instead is what mushes a sprite. A cell that
// holds body yellow, a shading yellow and two pixels of black outline has the
// two yellows as its commonest pair, so the outline gets rounded to the nearer
// of them and disappears — and an outline is one pixel wide everywhere, so it
// disappears everywhere at once. Scoring by squared error instead makes the
// outline worth keeping: collapsing the two yellows into one costs far less
// than collapsing black into yellow, so that is the split that wins.
//
// The mean of each group rather than a colour from it, because the mean is what
// minimises the error, and a run of near-identical yellows should come out as
// one yellow rather than as whichever of them happened to be commonest.
const bestSplit = (samples, bits) => {
  let best = null

  // Swapping foreground and background is the same picture, so only half the
  // assignments are distinct: fix the first pixel to the background.
  for (let assignment = 0; assignment < 1 << (samples.length - 1); assignment++) {
    const groups = [[], []]

    samples.forEach((colour, index) => groups[(assignment >> index) & 1].push(colour))

    const mean = (group) =>
      group.length
        ? [16, 8, 0].reduce(
            (packed, shift) =>
              packed |
              (Math.round(group.reduce((total, colour) => total + ((colour >> shift) & 255), 0) / group.length) <<
                shift),
            0,
          )
        : null

    const colours = groups.map(mean)
    let error = 0

    samples.forEach((colour, index) => {
      error += distance(colour, colours[(assignment >> index) & 1])
    })

    if (best && error >= best.error) continue

    let pattern = 0

    samples.forEach((unused, index) => {
      if ((assignment >> index) & 1) pattern |= bits[index]
    })

    best = { error, pattern, foreground: colours[1], background: colours[0] }
  }

  return best
}

// One cell: gather its pixels, pick two colours for them, then set a bit for
// every pixel that belongs to the foreground one.
const renderCell = (pixels, width, height, originX, originY, shape, style) => {
  const counts = new Map()
  const samples = []

  for (let y = 0; y < shape.height; y++) {
    for (let x = 0; x < shape.width; x++) {
      const px = originX + x
      const py = originY + y
      const inside = px < width && py < height
      const colour = inside ? key(pixels, (py * width + px) * 4) : TRANSPARENT

      samples.push({ x, y, colour })
      counts.set(colour, (counts.get(colour) ?? 0) + 1)
    }
  }

  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const opaque = ranked.filter(([colour]) => colour !== TRANSPARENT)

  // Nothing here. Say so plainly — letting "transparent" become the foreground
  // fills the cell with a solid block in whatever colour the terminal defaults
  // to, which is how empty space ends up drawn as a wall.
  if (opaque.length === 0) return '\x1b[0m '

  // A cell with no transparency in it is free to use both of its colours on the
  // artwork, so it gets the split that reproduces it best. A cell on the edge of
  // the sprite is not: its background has to stay the terminal's own or the
  // sprite ends up in a painted-on box, which leaves one colour for whatever
  // opaque pixels it holds, and that is the commonest one. Braille has one
  // colour either way — its dots are ink on nothing.
  if (style !== 'braille' && opaque.length > 1 && !counts.has(TRANSPARENT)) {
    const best = bestSplit(
      samples.map(({ colour }) => colour),
      samples.map(({ x, y }) => bitFor(style, x, y, shape.width)),
    )

    if (best.pattern === 0) return `${ansi(best.background, true)} `

    return `${ansi(best.background, true)}${ansi(best.foreground, false)}${glyphFor(style, best.pattern)}`
  }

  const foreground = opaque[0][0]

  // The background is either the empty space or the second colour, whichever
  // covers more of the cell. Braille only ever draws ink on nothing.
  const emptyCount = counts.get(TRANSPARENT) ?? 0
  const runnerUp = opaque[1]

  const background =
    style === 'braille' || !runnerUp || emptyCount >= runnerUp[1] ? TRANSPARENT : runnerUp[0]

  let bits = 0

  for (const { x, y, colour } of samples) {
    const toForeground =
      style === 'braille'
        ? colour !== TRANSPARENT
        : distance(colour, foreground) <= distance(colour, background)

    if (toForeground) bits |= bitFor(style, x, y, shape.width)
  }

  if (style !== 'braille' && bits === 0) return `${ansi(background, true)} `

  return `${ansi(background, true)}${ansi(foreground, false)}${glyphFor(style, bits)}`
}

export const toCellRows = (pixels, width, height, style) => {
  const shape = CELL_SHAPES[style]
  const rows = []

  for (let y = 0; y < height; y += shape.height) {
    let line = ''

    for (let x = 0; x < width; x += shape.width) {
      line += renderCell(pixels, width, height, x, y, shape, style)
    }

    rows.push(`${line}\x1b[0m`)
  }

  return rows
}
