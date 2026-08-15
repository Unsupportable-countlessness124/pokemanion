# pixel-runner

An animated sprite in the Claude Code status line. It runs while Claude works
and stands still when it doesn't.

```
▀▄   ▄▀
▀▀▀▀▀▀    ▄▄   Opus 5  ·  Campus-Dashboard-Event-Planner
▀▀▀▀▀▀▀▀▀▀▀▀   █████░░░░░ 47%  context
▀▀▀▀▀▀▀▀▀      using Bash…
▀▀▀▀▀▀▀
```

No dependencies. Everything — code, sprites, build output, runtime state —
lives in this one folder.

## Why it isn't inside the spinner line

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

## Use

```sh
npm run build              # decode the sprite into build/frames.json
npm run install-statusline # wire it into ~/.claude/settings.json
# restart Claude Code
```

Ask for a particular one:

```sh
npm run shell -- --install   # adds a claude() function to ~/.zshrc
# then
claude --pikachu
claude --resume --ash
claude --model opus --gengar
claude --pokemon             # pick from a numbered list
```

`--pokemon` lists everything available and waits for a number. A name works
too. Blank carries on under the usual rules; backing out starts nothing at all.

```
   1  pikachu
   2  ash
   3  charmander
   ...
  number, or blank for the usual:
```

Claude Code owns the `claude` command and rejects flags it does not know, so
these must never reach it. The function gets there first: it lifts out any
argument naming a Pokemon, passes everything else through untouched, and puts
the choice in `PIXEL_RUNNER_SPECIES`, which Claude Code inherits and passes on
to its hooks. Order does not matter and other flags are unaffected. Undo with
`npm run shell -- --remove`.

Without a flag, the pane gets Pikachu whenever Pikachu is free — close the
window it is in and the next terminal you open has it again — and otherwise a
Pokemon nobody else currently has. `npm run doctor` shows who holds what.

When the sprite is running at the wrong moment — still going after you pressed
escape, or still while Claude waits on an answer — `npm run watch` prints the
same decision the pane is making and what it rested on:

```sh
npm run watch          # every session
npm run watch 3ff282   # one, by the start of its id
```

Set `logHooks` to also record which hooks fired, to `.state/hooks.jsonl`. The
two together say whether Claude reported the end of a turn at all, and whether
the pane believed it.

Undo everything:

```sh
npm run uninstall-statusline
```

Your previous settings are copied to `~/.claude/settings.json.pixel-runner-backup`
the first time anything is written.

## Using a different sprite

Any GIF works. Drop it in `assets/`, point `config.json` at it, rebuild:

```json
{ "sprite": "assets/charizard.gif", "cols": 14, "rows": 5 }
```

```sh
npm run build
```

Preview any sprite at any size without installing:

```sh
node src/preview.mjs assets/pikachu-bw.gif 18 6
```

Each Pokemon waits as its Gen-5 Black/White front sprite and works as the same
sprite in its shiny palette. Meowth's paws, ears and tail go from brown to pink;
Psyduck would go from yellow to teal.

Both halves come from one place, which is the point:

```
https://play.pokemonshowdown.com/sprites/gen5ani/<name>.gif
https://play.pokemonshowdown.com/sprites/gen5ani-shiny/<name>.gif
```

Shiny is the same file recoloured, so it cannot be lower resolution than the
resting sprite, cannot clash with it in style, faces you, and stays the same
Pokemon. The cost is that the *motion* is identical — only the colour changes.
At this size that is the signal that reads fastest, but where it is not enough,
give the entry its own `busy` file and it overrides everything.

How far each shiny actually moves the colour, over the lit pixels of frame one:

```
psyduck 27%   bulbasaur 21%   eevee 20%   jigglypuff 17%   charmander 13%
munchlax 12%  squirtle 10%    haunter 8%  meowth 6%
```

Treat that as a hint, not a verdict. It averages over the whole sprite, so it
understates anything that recolours only its accents — Meowth scores 6% and is
obvious in the pane. Haunter is the genuinely weak one. Look before believing it.

Gen 5 holds exactly two animations per Pokemon — the front sprite and the back
one — so a genuinely *different* animation of the same Pokemon has to come from
somewhere else, and everywhere else loses on quality. Measured at the size the
pane draws:

| source | artwork | shown at | frames | |
| --- | --- | --- | --- | --- |
| Gen-5 front | 37-74px | 0.9-1.8x | 24-86 | the bar |
| Gen-5 back | 32-98px | 0.8-1.8x | 28-86 | same bar, facing away |
| Showdown `ani` (XY) | 45-133px | 0.5-1.5x | 25-106 | pale, smooth, 3D renders |
| PMDCollab | 18-31px | 2.5-3.6x | 3-12 | blobby, thick outline |

Shiny keeps both halves inside the top row for free: it *is* the top row, in a
different palette.

The evolved form also works and was tried here, but evolving is being kept back
for something else — a session that has run long enough evolves what is sitting
beside it. The silhouette flicker is already built for that; see
`docs/known-issues.md`.

The folder carries **895 species**, not the 649 that existed in Gen 5, because
Smogon's sprite project kept drawing in the Black/White style: Sylveon,
Toxtricity and Dragapult are all there and all measure 0.8-1.1x with 60-76
frames. Gen 7 onward is patchy — no Decidueye, Cinderace or Meowscarada — so
fetch a new entry before believing in it.

## The Pokedex

Twelve hundred names is not a list anyone reads, so there is a way to search it:

```sh
npm run dex                  # summary, and what is on disk
npm run dex -- charizard     # by name
npm run dex -- dragon        # by type
npm run dex -- 25            # by dex number
npm run dex -- current       # what the panes are showing now
npm run dex -- random        # be shown something
```

`current` reads the claim files rather than the roster, because that is the only
thing that knows: a pane may have been switched, handed a guest, or rolled at
random since it opened. Inside Claude it answers for *that* session; in a
terminal it lists every pane that is up.

and the same from inside Claude, which costs no turn:

```
--dex          --dex ghost          --dex 149          --dex random
--dex current  # the stats of whatever this pane is showing right now
```

A search with exactly one answer — or `random` — gets the long form instead of
a table row:

```
  Gurdurr

    no.     #533
    type    Fighting
    size    1.2m, 40kg
    colour  Gray
    ability Guts/Sheer Force/Iron Fist
    sprite  fetched when you summon it

  --gurdurr to summon it
```

To be handed one rather than choosing:

```sh
claude --random           # roll at launch
claude --resume --random  # works with the rest
```
```
--random                  # roll mid-session
```

The dice only ever land on a real Pokemon. The sprite folder also holds Pokestar
Studios movie props from Black 2, Smogon's invented CAP Pokemon and Alcremie's
decorative variants — 65 things with no real dex number — and rolling
"Pokestar UFO #-5001" is a bad surprise. They stay summonable by name.

```
  *   25 Pikachu              Electric      --pikachu
  .  330 Flygon               Ground/Dragon --flygon
     149 Dragonite            Dragon/Flying --dragonite
```

`*` is a resident, `.` a guest currently on disk, blank means it would be
fetched when you name it. The last column is the command that summons it.

A single result gets a card, with a Pokeball bobbing beside the stats. The ball
only appears in a real terminal — inside Claude the same text arrives as a
hook's blocking reason and is rendered as plain text, where an image escape
sequence would be printed literally instead of drawn.

Number, name and types for all 1252 are bundled in `assets/gen5-dex.json`
(51KB, built from Showdown's pokedex), so searching never touches the network.

## Residents and guests

All 1255 names the sprite folder has are available. They are not all on disk.

**Residents** are `ROSTER` in `src/roster.mjs` — hand-tuned, always present,
pre-rendered so a session starts instantly, and the only ones the rotation hands
out. **Guests** are everything else: fetched the first time you name them, kept
while you use them, and evicted when the space is wanted.

```sh
claude --flygon      # fetched on the spot, about a second the first time
--flygon             # same thing from inside Claude
npm run prune        # evict now; happens on its own as sessions open
npm run prune -- --dry
```

The split exists because the whole set pre-rendered is roughly **2.7GB** of
frame cache and twenty-five minutes of work. Guests cost 1-5MB each.

Eviction is least-recently-shown first, bounded by two settings:

| key | default | meaning |
| --- | --- | --- |
| `guestBudgetMb` | `200` | total disk guests may hold |
| `guestKeepDays` | `14` | a guest unused this long goes regardless |

Residents are never evicted. Names are matched the way the folder spells them,
with punctuation forgiven — `--ho-oh` finds `hooh`, `--porygon-z` finds
`porygonz` — and form names work as written: `--rotom-wash`, `--charizard-mega-x`.

To promote a guest to a resident, add its name:

```js
{ name: 'totodile' },
```

To use your own files instead — a GIF you found anywhere — point the entry
straight at them, which is how Pikachu and Ash work:

```js
{ name: 'ash', idle: 'assets/10-ash-standing.gif', busy: 'assets/11-ash-running.gif', busySpeed: 1 },
```

Hand-picked files are never re-downloaded or overwritten. Big smooth GIFs are
fine — `recoverNative` in `prepare.mjs` divides out whole-number upscales, so a
500x488 sprite that is really 40x39 is treated as 40x39.

`npm run roster` downloads everything in `src/roster.mjs`; add `--refresh` to
re-download ones already here. `npm run warm` renders them all into the frame
cache so a session's pane draws immediately.

## Settings

`config.json`, all optional:

| key | default | meaning |
| --- | --- | --- |
| `sprite` | `assets/pikachu-showdown.gif` | GIF to animate |
| `rows` | `10` | height in terminal cells (snapped — see below) |
| `cols` | `null` | width; `null` derives it from the sprite's proportions |
| `sampler` | `mode` | how a pixel is chosen when scaling down — see below |
| `style` | `sextant` | how many pixels fit in one cell — see below |
| `snap` | `true` | force a whole-number reduction. Leave this on |
| `palette` | `6` | flatten to this many colours before shrinking; `0` disables |
| `frameMs` | `200` | how long one frame is held |
| `maxFrames` | `12` | source frames are sampled down to this many |
| `animateWhenIdle` | `false` | keep moving when Claude isn't working |
| `workingTimeoutMs` | `120000` | how long after the last hook we still count as working |
| `idleAfterMs` | `20000` | transcript silence that counts as finished — see `docs/known-issues.md` |
| `transitions` | `true` | play an animation when the sprite changes over |
| `logHooks` | `false` | append every hook to `.state/hooks.jsonl` for diagnosis |

A Pokeball opens when a Pokemon **arrives** — the pane starting up, or a species
being switched to. Not when Claude starts or stops working.

That split is deliberate. Waiting-to-working happens constantly and has to stay
readable at a glance, so it gets a quick flash. Arriving happens when you ask for
it, so it can afford a second and a half of ceremony. Playing the ball on every
work switch would bury the signal under the celebration.

Turn it off with `"pokeball": false`.

The rest are transitions between the two sprites, and an entry gets whichever
fits what is actually changing:

| kind | when | what it does |
| --- | --- | --- |
| `flash` | the same Pokemon recoloured | white, colour, white, colour, white — 326ms, accelerating 90ms to 40ms |
| `evolve` | two different Pokemon | their two silhouettes traded back and forth — 680ms, 130ms to 40ms |

Every shiny pair flashes. It matters more than decoration: a shiny works as the
resting sprite recoloured and *moves identically*, so without the flash there is
no moment where anything visibly happens.

`evolve` is set by `becomes`, which nothing uses today — see
`docs/known-issues.md`.

Pikachu, Ash and Psyduck get neither. Standing and running is not a
transformation, and announcing one would be a lie. A hand-picked pair that *is*
a recolour has to say so, since nothing can infer it from the files:

```js
{ name: 'charizard', idle: '...', busy: '...', transition: 'flash' },
```

## Changing Pokemon mid-session

Type the flag at Claude, as a prompt on its own:

```
--squirtle      switch this session's pane to Squirtle
--pokemon       list them, marking the current one
```

The sprite changes in place — no new window, no restart, and the pane keeps its
position. The switch also updates the claim, so other terminals still see what
is taken.

The prompt never reaches Claude. A `UserPromptSubmit` hook recognises it, writes
the name to the claim file the pane already watches, and exits 2, which blocks
the prompt and erases it — so it costs no turn and no tokens. The reply you see
is the hook's stderr.

Only a prompt that is **entirely** the flag counts. `what does --pikachu do?` is
a real question and goes to Claude untouched.

Leave `cols` at `null`. Fixing both dimensions by hand is how the sprite ends up
squashed sideways: a half block cell is two pixels tall and one wide, and
terminal cells are about twice as tall as they are wide, so a sprite pixel is
square and the source aspect ratio carries through on its own.

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
