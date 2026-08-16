---
name: adding-a-character
description: Add a Pokémon or character to pokemanion from image files the user has — installing a sprite pair, cutting cycles out of a sheet, keying a background off, judging whether art will read at pane size. Use when someone wants a new sprite, character or Pokémon in their pokemanion pane, or hands you a gif or png and asks to make it a resident.
---

The user has a picture and wants it living in their terminal. Your job is the
judgement: which frames, whether the art will survive being shrunk, and what to
write on its Pokédex card. The mechanical half is one command.

## What to ask

They may arrive here by typing `--pokemanion add brock`, which does nothing but
hand you this job. Ask one thing at a time and wait — several questions at once
gets one answer.

1. **The resting animation.** A gif or png of what it does while waiting. They
   can drag the file in.
2. **The working animation** — what it does while the agent is busy. The same
   file again is fine when both cycles live in one sheet.
3. **Whether anything needs cutting.** Say what you can see, so they are
   choosing rather than guessing: "this has 36 frames, so it looks like four
   walk cycles — shall I take the front-facing ones for resting and the side-on
   ones for working?" A sheet of figures side by side needs `crop` instead, and
   two halves whose colours disagree need `recolour`.

If they gave you everything in the first message, do not ask again — go and
look at the files.

Everything here needs a source install — it writes to `src/roster.mjs`. A plugin
copy is version-stamped and replaced on the next `/plugin update`, so anything
added there is lost. If they installed the plugin, say so before starting.

## The one command

```sh
npm run add -- <name> <resting-file> <working-file> [--resting=A-B] [--working=A-B] [--halo]
```

It prepares the art, copies it into `assets/` under the next free number, writes
the roster entry, regenerates the gallery, every count and the credits, stages
the files, and tells you what it did. Afterwards `--<name>`, `claude --<name>`,
`--dex <name>`, the picker and did-you-mean all work.

| | |
| --- | --- |
| `--resting=0-8` | use only those frames of the resting file — zero-based, inclusive |
| `--working=12-17` | the same for the working half |
| `--halo` | also remove the pale fringe a blurry upscale leaves around a figure |

A flat background is always keyed out by filling in from the edges, so a white
card goes while a white shirt stays. `--halo` goes further and takes every pale
colourless pixel, including pockets a fill cannot reach — the gaps between
Brock's hair spikes. It would also blind a sprite with white eyes, so it is
asked for rather than assumed.

## Look at the art first

Two things have sunk every sprite tried in this project, and both are visible
before you install anything.

**A working half that cannot move.** A single frame is a picture, not an
animation. Attempts to animate a still here — growing a water jet out of a
Squirtle, alternating two poses — were all reverted for looking synthesised,
because they were. If the working file has one frame, say so and ask for
another.

**Art that was resampled rather than drawn.** Decode it and look at the run
lengths along a row: pixel art repeats each pixel by its upscale factor, so a
clean 3x upscale gives runs of 3, which `recoverNative` divides back out. Runs
of 1 in a large image mean it was resized with smoothing, there is no grid to
recover, and it will read soft beside sprites that snap to the terminal's cells.
Runs of 1 in a *small* image are simply what pixel art is.

`npm run add` reports both of these before it copies anything.

## Then look at it at the size it will be drawn

This is the step that has been right every time measurements were wrong. The
pane draws a sprite about 68 pixels tall. Decode the gif, scale a few frames to
that height onto a dark background, magnify for your own eyes, write a png and
**read it**.

```js
import { readFileSync, writeFileSync } from 'node:fs'
import { decodeGif } from './src/gif.mjs'
import { encodePng } from './src/pngwrite.mjs'
```

A filmstrip of every frame side by side is the fastest way to see whether a
cycle actually cycles, and whether the frames belong to one direction or four.

## Cutting a sheet apart

Sprite sheets arrive in two shapes, and they need different tools.

**Several cycles across the frames of one gif** — a four-direction walk is
usually front, side, back, side. Find the boundaries by rendering the frames and
reading them, then pass `--resting=0-8 --working=12-17`.

**Several figures side by side in one image** — use `npm run crop` first:

```sh
npm run crop -- sheet.gif out.gif --find=3      # the third figure along
npm run crop -- sheet.gif out.gif 40 0 66 85    # or x y w h
```

`--find=N` groups the inked columns into runs and takes the Nth, which is how
Ash was cut out of a sheet of five trainers.

## The rest of the toolbox

| | |
| --- | --- |
| `npm run key -- in.gif out.gif` | make a flat background transparent, no re-encode |
| `npm run recolour -- a.gif b.gif out.gif` | repaint one palette to match another |
| `npm run flip -- in.gif out.gif` | mirror left to right |
| `npm run dex -- <name>` | check whether a name is a real Pokémon before using it |
| `npm test` | sprites committed, counts right, cards fit the pane |

Two palettes that disagree are worth fixing: alternating a blue pose with a teal
one reads as a colour flashing rather than as a character moving.

## Cards, for anyone who is not a Pokémon

The bundled Pokédex is built from Showdown's data and contains no people, so a
human resident needs a `card` in their roster entry or `--dex brock` has nothing
to answer with. `npm run add` writes the shape and leaves it empty:

```js
card: {
  title: 'Brock',
  blurb: 'The Rock-type Gym Leader of Pewter City, who handed the gym to his father and left to travel with Ash…',
  facts: [['species', 'Human'], ['from', 'Pewter City'], ['goal', 'Pokémon Breeder']],
  pane: ['Brock', 'Pewter City Gym', 'Type : Rock', 'Goal : Pokemon Breeder'],
}
```

`blurb` is the paragraph in the conversation. `pane` is what fits beside the
sprite, so keep every line short — `npm test` fails if one is too wide.

## When you are done

`npm test`, then tell them to open a new session. A pane already running was
started before the entry existed and cannot know about it. Neither Ghostty nor
the agent needs restarting.

## Worked example

A user drops in one gif of a character walking in four directions and asks for
them as a resident:

1. Decode it. 36 frames, 283x199, runs of 1 — a resampled upscale, so warn them
   it will read soft, and expect a pale halo.
2. Render the frames as a filmstrip and read the directions off it: 0-8 face
   you, 12-17 are side on, the rest walk away.
3. Front for resting, side for working, because that is the division that reads
   as waiting versus working.
4. `npm run add -- brock sheet.gif sheet.gif --resting=0-8 --working=12-17 --halo`
5. Render the result at 68 pixels tall and look at it before believing any of
   the above.
6. Write the card, run `npm test`, tell them to open a new session.
