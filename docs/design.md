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

## Choosing a working sprite

The resting sprite was never in question: the Gen-5 Black/White front sprite,
as drawn. The working one took four attempts, and the numbers are why.

Everything measured at the size the pane actually draws — roughly 68 pixels
tall — after `recoverNative` has divided out any whole-number upscale and the
frame has been cropped to its artwork:

| source | artwork | shown at | frames | verdict |
| --- | --- | --- | --- | --- |
| Gen-5 front | 37-74px | 0.9-1.8x | 24-86 | the bar |
| Gen-5 back | 32-98px | 0.8-1.8x | 28-86 | same bar, but facing away |
| Showdown `ani` (XY) | 45-133px | 0.5-1.5x | 25-106 | more pixels, 3D renders — pale and soft |
| PMDCollab | 18-31px | 2.5-3.6x | 3-12 | a third of the resolution magnified twice as far |

PMDCollab is what shipped first and it read as cheap for a reason the table
makes obvious: three frames where the idle has fifty. Showdown's XY set fails
the opposite way — it is *higher* resolution and still looks worse, because it
is 3D renders rather than drawn pixel art.

What won is the **shiny palette**: the same file recoloured, so it cannot be
lower resolution, cannot clash in style, faces you, and stays the same Pokemon.
Its honest cost is that the motion is identical. That is what the white flash is
for — without an event at the switch, a recolour is not noticeable enough to
work as a status signal.

How far each shiny moves the colour, over the lit pixels of frame one:

```
psyduck 27%   bulbasaur 21%   eevee 20%   jigglypuff 17%   charmander 13%
munchlax 12%  squirtle 10%    haunter 8%  meowth 6%
```

Treat those as a hint. The number averages over the whole sprite, so it
understates anything that recolours only its accents: Meowth scores 6% and is
obvious in the pane, because its paws, ears and tail go brown to pink while the
cream body stays put. Haunter is the genuinely weak one.

The **evolved form** also works, and looked good — Charmander rests, Charizard
beats its wings. It is deliberately unused, saved for a different idea: a
session that has run long enough evolves the Pokemon beside it. Spending the
moment on "Claude is busy" would waste it.

## How to judge a sprite

Never from the name, the source's reputation, or the file size. In order:

1. **Measure it at pane size.** Native resolution after `recoverNative`,
   artwork size after cropping, the resulting scale, the frame count. The bar
   is **scale ≤ 1.8x and ≥ 24 frames**.
2. **Render a filmstrip and look at it**, cropped and scaled the way the pane
   will draw it.
3. **If two candidates look alike, measure frame-to-frame change.** This has
   overruled the eye twice. Gengar's supplied animation looked identical to its
   idle and moves 45% more per frame (55% against 38%).

File size lies in both directions. A 500x500 GIF that is really 40x39 blown up
twelve times is pixel art and scales beautifully; a 407x295 smooth render with
no recoverable pixel grid shrinks to mush. Two other things worth checking that
have each caught a candidate:

- **Two characters in one frame.** One supplied Psyduck animation had Pikachu
  running alongside it, which is charming and also puts Pikachu in someone
  else's pane.
- **Palette drift between a supplied pair.** Cubone's two GIFs were drawn by
  different hands and their average lit-pixel colour differs by 20% — about as
  much as a shiny — so it reads as a recolour as well as a pose change.

## What the hooks actually do

Claude Code documents its hook events but not what happens at the edges, and the
sprite is wrong exactly when an assumption about that is wrong. Everything here
was established by logging real sessions to `.state/hooks.jsonl`, not by
reading the documentation.

- **There is no hook for pressing escape.** This is the whole reason the pane
  reads the transcript.
- **An interrupted tool still reports its `PostToolUse`**, on the same
  millisecond the interruption marker is written — and a hook is a whole node
  start-up behind a file write, so it lands *after* the interruption is noticed.
  Comparing against the last hook made a freshly interrupted session look like
  the busiest one there is.
- **`UserPromptSubmit` carries the prompt text**, and **exit code 2 blocks the
  prompt and erases it**, showing stderr as the reason. That pair is what makes
  `--pikachu` cost no turn and no tokens.
- **Messages typed while Claude is already working never fire
  `UserPromptSubmit`.** They are injected into the running turn, so a
  mid-turn `--random` reaches the model as an ordinary prompt and nothing
  intercepts it.
- **`SessionStart` fires for background agents too**, which is why opening the
  agents list used to split whichever Ghostty window had focus. They are
  recognised by a file in `~/.claude/jobs`.

## Which Pokemon a session gets

Three rules, tried in order, in `chooseSpecies`:

1. **Asked for by name** — `claude --ash`, or `--ash` typed at Claude. That one,
   always. It outranks Pikachu-comes-first, Pikachu being free, the Pokemon
   already being out in another window, and `randomPokemon` being off.
2. **Remembered** — what this session was given last time, if the sprite is
   still on disk and no other pane is holding it.
3. **The rotation** — `pickFor`: Pikachu if free, otherwise
   `hash(sessionId) % choices.length` over the ones nobody holds.

Rule 2 was missing, and its absence was a bug worth writing down because the
symptom looked impossible: **a pane changed Pokemon with nothing typed.**

The species was never stored, only recomputed. Rule 3 is stable given its
inputs, but two of the three inputs move on their own — the set of Pokemon other
panes hold, and the length of the list itself, which shrinks when the pruner
evicts a guest. Count the same distance into a shorter list and you land
somewhere else. Every session re-picks at once when the pool changes size.

What made it reachable at all was that `.species` was doing two jobs:

| meaning | lifetime |
| --- | --- |
| this pane is showing Cubone | should outlive the pane |
| Cubone is taken, give the next terminal something else | must die with the pane |

The pane deletes the file on exit — correctly, that is how Pikachu comes back
when you close a window — and took the first meaning's answer with it. So the
two meanings now have two files: `.species` unchanged and ephemeral,
`assigned.json` durable and keyed by session id.

Two things fell out of fixing it:

- **A guest a pane is showing is no longer evicted.** Nothing touches a guest's
  last-used stamp while it simply sits there being looked at, so a window open
  longer than `guestKeepDays` had its own sprite deleted underneath it, and the
  pane refuses to draw a species whose files are missing.
- **The choice is logged.** `hooks.jsonl` recorded what was asked for by name and
  nothing else, so a rotation pick left no trace anywhere. When one of these did
  change on its own, the only way to explain it was to reconstruct the pick from
  the state of the disk afterwards and hope nothing had moved in between. There
  is now a `choose` line carrying the species and which rule produced it.

## Traps that bit more than once

Written down because each of these cost real time and none of them announced
itself.

**A running process does not have your new code.** The pane is a long-lived
node process. Editing `roster.mjs` changes nothing about the pane already
drawing, and the symptom is a feature that "does not work" while every test
passes. Compare the pid's start time against the source file's mtime before
believing anything else.

**A cache keyed by its inputs never notices it is stale.** Bumping
`CACHE_VERSION` changes every key, so old entries become unreachable — but they
are not *deleted*, because nothing can tell they are orphaned. That happened
three times and left 42MB, then 36MB, then 72MB. Entries now record the version
that wrote them, and `npm run prune` sweeps mismatches.

**A check that looks in one place reports confidently about everywhere.** The
cache-coverage check passed on a single stray sprite left at the right height
while ten Pokemon still stalled for two seconds each. The attribution generator
reported both Pokeballs as unused because it only read the roster. Count what
you expect, do not test for presence.

**`node --check` does not catch a missing import.** Extracting the renderer into
`sprite.mjs` left `MIN_DELAY` behind in `window.mjs`; the syntax check passed
and the pane died on launch. Only running the thing found it.

**A pure function of changing inputs is not a stable answer.** `pickFor` is
deterministic and was treated as if that made it fixed. It hashes the session id
— stable — modulo the number of available Pokemon, which is not. Deterministic
means the same inputs give the same answer, and that is worth nothing when the
inputs are the parts that move. If something must not change, store it.

**Log the decision, not just the request.** Only explicit `--pikachu` asks were
recorded, so the interesting case — the one nobody typed — was the one with no
evidence. The cheapest possible line at the moment of the choice is worth more
than any amount of reconstruction afterwards.
