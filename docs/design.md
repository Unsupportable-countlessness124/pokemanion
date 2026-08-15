# Design notes

Why the thing is built the way it is. None of this is needed to use it — the
README is the guide. This is the reasoning, kept because most of it was learned
the hard way and would otherwise be re-learned the same way.


## Why it isn't inside the spinner line (background)

The obvious place for this is next to `Actioning…`, and that turns out to be
closed off. Claude Code 2.1.221 exposes exactly three spinner settings —
`spinnerVerbs`, `spinnerTipsEnabled`, `spinnerTipsOverride`. There is no setting
for the animated glyph, and the verb is chosen once per turn:

```js
let [K] = SK.useState(() => O$(GWt()))   // GWt() reads your spinnerVerbs
```

`useState` with an initialiser — picked at mount, never re-rolled. So a sprite
put there through config would freeze for the whole turn. On top of that the
spinner is a single text row, and a recognisable sprite needs four or more rows
of half blocks.

The status line sits directly beneath it, takes as many rows as we want, and
does re-run. So the sprite goes there, and `install.mjs` also swaps the spinner
verbs for themed ones so the two rows read as a single unit.

## How fast it can animate

Two things re-run the status line: a `refreshInterval` timer, clamped in the
binary to a one second floor —

```js
refreshInterval: E.number().min(1)
```

— and event-driven updates, debounced at 300ms, which fire as token usage
changes while Claude streams. So it holds at 1fps when idle and picks up to
roughly 3fps while Claude is actually working, which is when you're looking at
it. The frame is derived from the wall clock rather than a counter, so the
animation runs at a constant speed no matter how often we happen to be called.

## Cost

25ms per tick, once a second. About 2.5% of one core while a session is open.
If that bothers you, drop `refreshInterval` from the `statusLine` block in
`~/.claude/settings.json`: the sprite then only advances when a message updates,
which still animates while Claude works but goes still when idle.

## Don't average when scaling down

The first version of this box-filtered the sprite down and it came out as yellow
mush. A sprite's outline is one pixel wide, so it is a minority of every block it
falls in and the mean slides towards the body colour. Measured on the bundled
Pikachu, whose source is 16.7% outline pixels:

| sampler | outline surviving |
| --- | --- |
| average | 3.8% |
| `nearest` | 16.2% |
| `mode` | 19.2% |
| `outline` | 26.9% |

`mode` — the most frequent colour in the block — tracks the source most closely
and keeps flat regions flat, so it is the default. `outline` biases towards dark
pixels and is worth trying below about six rows. Averaging isn't offered.

## Scale by a whole number

This matters more than the sampler. Reducing a 60px sprite to 16px is a factor
of 3.75, so some output pixels average a 3x3 block of the source and their
neighbours average 4x4. Edges that are straight in the sprite come out ragged
and the whole thing reads as mush no matter how good the sampler is.

`snap: true` rounds `rows` to the nearest size that divides the source evenly.
The height has to divide cleanly *and* stay even, because two pixel rows share a
cell — for the bundled 60px Pikachu that permits 3, 5, 6, 10 or 15 rows, but not
8. Ask for 8 and you get 10, at exactly 3x. `npm run build` prints what it chose:

```
size     20x10 cells, style half, sampler mode
scaling  3x exactly — snapped rows 8 -> 10
```

## Flatten the palette

A sprite carries more shades than survive being shrunk. Pikachu's body is one
yellow plus two shading yellows, and at 3x neighbouring blocks land on different
shades, so a flat belly breaks into speckle. `palette: 6` collapses the sprite to
its six most-used colours first — outline, body, shade, cheek, eye, highlight —
which puts the flat areas back. Rendered frame goes from 13 colours to 6.

The palette is counted across every frame, so a region never flickers between two
shades as the animation runs. Nothing is really lost: the source is drawn in flat
colour to begin with.

## The limit is the terminal

Once averaging, aspect, scaling and palette are all right, what's left is
resolution, and that is fixed by how many rows you are willing to spend. At
`rows: 10` the sprite is 20x20 pixels. That is the whole budget.

For the bundled 60px Pikachu:

| rows | reduction | pixels | reads as |
| --- | --- | --- | --- |
| 5 | 6x | 10x10 | a yellow blob |
| 6 | 5x | 12x12 | ears and tail visible |
| 10 | 3x | 20x20 | clearly Pikachu — the default |
| 15 | 2x | 30x30 | sharp, but half your terminal |
| 30 | 1x | 60x60 | the sprite exactly as drawn |

There is no setting that beats this trade. If you want it sharper, spend rows.

## More detail without more rows

The number of rows is not the real limit — how finely a cell is divided is.
Unicode has glyphs that cut a character cell into halves, quarters, sixths or
eighths, so the same eight rows can carry four times the pixels.

The price is colour. A cell is one glyph with one foreground and one background,
so however many pixels it holds, only two colours can appear in it. Each cell
picks the two that fit its own pixels best. Sprites are drawn in flat colour, so
most cells sit inside one region and lose nothing.

| style | pixels per cell | the 50x46 Gen-5 sprite at 8 rows |
| --- | --- | --- |
| `blocks` | 1 (1x1) | 4x reduction, always solid |
| `half` | 2 (1x2) | 3x reduction |
| `quad` | 4 (2x2) | 3x, twice the horizontal detail |
| `sextant` | 6 (2x3) | **2x reduction** |
| `braille` | 8 (2x4) | 2x — and 1:1 by 12 rows |

Braille packs the most in and is in every font, but the dots do not fill the
cell, so it reads as dot matrix rather than solid, and it only carries one colour
per cell. Sextants are the best looking if your font has them.

Check what your font supports before choosing:

```sh
npm run fontcheck
```

Any family that renders as a row of identical empty rectangles is missing.

## Seams: `half` vs `blocks`

`half` uses the ▀ glyph to fit two pixels in one cell. It has twice the vertical
detail, but it is a *glyph*, and a terminal configured with any line spacing
draws a gap underneath every row — the sprite comes out visibly striped, and no
amount of resampling will fix it.

`blocks` paints one pixel per cell as a background colour behind two spaces.
Backgrounds fill the whole cell whatever the line spacing is, so it is always
solid. The cost is half the vertical detail and double the width.

Apple Terminal is the common case where `half` looks striped. iTerm2, Kitty,
WezTerm and Ghostty all let you set line height to 1.0, which makes `half`
seamless and strictly better.

See both, with every sampler, in your own terminal:

```sh
npm run compare
```

## Layout

```
src/gif.mjs       GIF87a/89a decoder — LZW, interlacing, frame disposal
src/render.mjs    RGBA frames -> half-block ANSI rows
src/build.mjs     pre-renders everything into build/frames.json
src/preview.mjs   print every frame to look at it
bin/statusline.mjs  what Claude Code runs each tick
bin/on-activity.mjs hook handler; records working/idle into .state/
bin/run.sh        finds node under a hook's trimmed PATH
install.mjs       settings.json wiring, with --uninstall
```

The decode happens at build time, not per tick, which is what keeps the runtime
at 25ms.

## Sprites

The bundled GIFs come from the PokeAPI sprite collection. Pokémon sprites are
Nintendo/Game Freak property, fine for a local toy, not for redistribution.
Swap in your own artwork if this becomes anything more than that.
