# Attribution

The code here is MIT (see LICENSE). The artwork is not, and none of it is mine.
This file says what came from where, because shipping someone's work without
naming them is the part that is actually rude.

## Pokemon sprites

Everything in `assets/pokemon/`, and the resting halves of most roster entries.

- **Downloaded at runtime** from `play.pokemonshowdown.com/sprites/gen5ani/`
  by `npm run roster`. Not committed — `assets/pokemon/` is gitignored — so a
  clone fetches its own copies.
- **Generation 5 sprites** (the Black/White animated set) are the work of
  Game Freak, and are the property of Nintendo / Game Freak / The Pokemon
  Company.
- **Later-generation sprites in the same style** — Sylveon, Toxtricity,
  Dragapult and the rest — were drawn by artists of the Smogon sprite project.
  The [smogon/sprites](https://github.com/smogon/sprites) repository states
  that their licence is still being decided and asks that you speak to them
  before using them.

`assets/gen5-dex.json` and `assets/gen5-names.json` are built from Showdown's
pokedex data: names, numbers, types, sizes and abilities. Facts about Pokemon
rather than artwork, but they came from there.

## Hand-picked GIFs

The numbered files in `assets/`. These are fan art found online, kept in the
repository because no command can bring them back — the source pages are not
always still there, and none of them offer a download API.

| file | what it is |
| --- | --- |
| `3-standing.gif`, `9-pikachu-run.gif` | Pikachu standing and running |
| `10-ash-standing.gif`, `11-ash-running.gif` | Ash Ketchum |
| `12-psyduck-running.gif` | Psyduck, animated |
| `13-psyduck-pikachu.gif` | Psyduck and Pikachu running together (unused) |
| `14-charizard.gif`, `15-charizard-shiny.gif` | Charizard, normal and shiny |
| `16-charizard-firing.gif` | Charizard breathing fire |
| `17-pokeball.gif`, `20-pokeball-floating.gif` | a Pokeball opening, and bobbing |
| `18-meowth-jumping.gif` | Meowth mid-jump |
| `19-gengar-moving.gif` | Gengar |
| `21-cubone.gif`, `22-cubone-swinging.gif` | Cubone, and swinging its bone |

If you drew one of these and would rather it were not here, open an issue and
it will be removed — the project reads sprites from `assets/` by path, so
taking one out is a one-line change to `src/roster.mjs`.

## Everything else

Pokemon is a trademark of Nintendo. This is a personal tool, not affiliated
with or endorsed by anyone, and nothing here is sold.
