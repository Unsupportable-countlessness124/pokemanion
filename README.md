# pokemanion

**Your Pokémon companion for Claude Code.** One lives in a pane beside every
session: it rests while Claude waits, and does something else while Claude
works — so you can tell from the corner of your eye whether anything is
happening.

<table>
<tr>
  <th align="left" width="16%">waiting</th>
  <th align="left" width="20%">working</th>
  <th align="left">&nbsp;</th>
</tr>
<tr>
  <td><img src="assets/14-charizard.gif" width="90" alt="Charizard standing"></td>
  <td><img src="assets/16-charizard-firing.gif" width="150" alt="Charizard breathing fire"></td>
  <td>Charizard breathes fire across the empty half of the pane.</td>
</tr>
<tr>
  <td><img src="assets/21-cubone.gif" width="70" alt="Cubone standing"></td>
  <td><img src="assets/22-cubone-swinging.gif" width="70" alt="Cubone swinging its bone"></td>
  <td>Cubone swings its bone.</td>
</tr>
<tr>
  <td><img src="assets/3-standing.gif" width="70" alt="Pikachu standing"></td>
  <td><img src="assets/9-pikachu-run.gif" width="110" alt="Pikachu running"></td>
  <td>Pikachu runs. It is the one everything else was tuned against.</td>
</tr>
</table>

Fourteen hand-tuned residents ship with it. **1252 more** can be summoned by
name and are fetched on the spot.

<img src="assets/17-pokeball.gif" width="46" align="left" alt="a Pokeball opening">

A Pokéball opens whenever one arrives, and its stats appear beside it for a few
seconds. Everything is local: no account, no backend, nothing about you leaving
the machine.

<br clear="left">

## What it needs

| | |
| --- | --- |
| **macOS** | the pane is a Ghostty split driven by AppleScript, and the shell wrapper edits `~/.zshrc` |
| **Ghostty** | for the kitty graphics protocol — the sprite is a real image, not text. Any kitty-protocol terminal should do |
| **chafa** | `brew install chafa` |
| **Node ≥ 20** | no dependencies, nothing to install |

## Install

```sh
git clone https://github.com/<you>/pokemanion.git
cd pokemanion

npm run roster                # fetch the sprites
npm run warm                  # render them for a 4-row pane
npm run install-statusline    # wire the hooks into ~/.claude/settings.json
npm run shell -- --install    # add the claude() wrapper to ~/.zshrc
```

Then **restart Claude Code** and open a new terminal. A pane should appear
beside your next session.

```sh
npm run doctor                # if it doesn't
```

`doctor` is the thing to run whenever something looks wrong. It checks the hooks
are registered, chafa is present, the frame cache matches your pane height, and
which Pokémon are currently held.

Undo it all with `npm run uninstall-statusline` and `npm run shell -- --remove`.
Your previous settings are copied to `~/.claude/settings.json.pixel-runner-backup`
the first time anything is written.

## Commands

Starting a session:

```sh
claude --pikachu             # a particular one
claude --flygon              # any of the 1252, fetched on first use
claude --random              # be handed one
claude --pokemon             # pick from a list
claude --resume --charizard  # combines with everything else
```

Typed at Claude, inside a session. These never reach the model — a hook answers
them and blocks the prompt, so they cost no turn and no tokens:

```
--squirtle          switch this pane, live, no restart
--random            roll one
--pokemon           list the residents

--dex               what you have, and how many exist
--dex ghost         every Ghost type
--dex 149           by number
--dex dragonite     by name
--dex current       the stats of the one you're looking at
--dex random        be shown something
```

A prompt that is *only* the flag counts. `what does --pikachu do?` is a real
question and reaches Claude untouched.

Punctuation is forgiven, and form names work as written: `--ho-oh` finds
`hooh`, `--rotom-wash` and `--charizard-megax` are exactly themselves.

### Everything you can run

| command | what it does |
| --- | --- |
| `npm run doctor` | check every piece: hooks, chafa, cache, who holds what |
| `npm run roster` | download any missing resident sprites (`-- --refresh` to redo them) |
| `npm run warm` | render the residents for a pane height (`-- 5` for five rows) |
| `npm run prune` | evict guests now (`-- --dry` to see what would go) |
| `npm run dex` | the Pokedex, from a terminal: `-- fire`, `-- 25`, `-- current`, `-- random` |
| `npm run watch` | print the working/waiting decision the pane is making, live |
| `npm run attribution` | regenerate the credits list (`-- --check` to fail if stale) |
| `npm run shell -- --install` | add the `claude()` wrapper to `~/.zshrc` (`--remove` to undo) |
| `npm run install-statusline` | register the hooks (`npm run uninstall-statusline` to undo) |
| `npm run window` | run a pane by hand, for debugging |
| `npm run build` | rebuild the status-line frames from `config.json` |

`doctor` and `watch` are the two worth remembering. `doctor` answers "is this
set up right", and `watch` answers "why is the sprite doing that" — it prints
the same decision the pane is making and what it rested on.

The rest are tools for tuning how a sprite is drawn, from working out what a
terminal can render — `preview`, `compare`, `sizes`, `bakeoff`, `use`,
`preset`, `fontcheck`, `cellcheck`, and `for-ghostty` / `for-terminal` /
`for-exact` / `for-small`. [docs/design.md](docs/design.md) is what they are
for. **`preset` and the `for-*` ones write to `config.json`** rather than just
reporting, which is easy to trigger by accident while poking around.

`choose` and `companion` are internal: the shell wrapper and the hooks call
them, and there is no reason to run them by hand.

## Your own sprites

Any GIF works. Drop it in `assets/` and point a roster entry at it:

```js
// src/roster.mjs
{ name: 'meowth', busy: 'assets/18-meowth-jumping.gif', busySpeed: 1 },
```

Hand-picked files are never overwritten or re-downloaded, and they override the
default — which is the Pokémon's own shiny palette, with a white flash between.

Judge a candidate at the size the pane actually draws, about 68 pixels tall.
File size lies in both directions: a 500×500 GIF that is really 40×39 upscaled
is pixel art and scales beautifully, while a 407×295 smooth render shrinks to
mush. `npm run attribution` regenerates the credits list when you add one.

## Residents and guests

**Residents** are the 14 in `src/roster.mjs`: hand-tuned, always on disk,
pre-rendered so a session starts instantly, and the only ones the rotation hands
out. Pikachu goes to whoever is free to have it.

**Guests** are the other 1252. They arrive when you name them — about a second —
stay while you use them, and are evicted least-recently-shown first.

```sh
npm run prune            # evict now; happens on its own as sessions open
npm run prune -- --dry
```

The whole set pre-rendered would be about **2.7 GB** of frame cache and
twenty-five minutes of work, which is the entire reason for the split. Guests
cost 1–5 MB each, bounded by `guestBudgetMb` (200) and `guestKeepDays` (14).

## Settings

`config.json`, all optional. The ones worth knowing:

| key | default | meaning |
| --- | --- | --- |
| `windowRows` | `4` | how tall the pane is |
| `idleAfterMs` | `20000` | transcript silence that counts as finished |
| `workingTimeoutMs` | `120000` | how long after the last hook we still count as working |
| `transitions` | `true` | animate the change between the two sprites |
| `pokeball` | `true` | open a Pokéball when one arrives |
| `cardMs` | `8000` | how long the stats stay beside the sprite; `0` disables |
| `guestBudgetMb` | `200` | disk the guests may hold |
| `logHooks` | `false` | record every hook to `.state/hooks.jsonl` |

## How it knows Claude is working

This is inference rather than a signal, and it is the part most likely to
surprise you. Claude Code rings a hook when you submit a prompt and around each
tool — but there is **no hook for pressing escape**, so an interrupted turn
looks identical to a running one.

So the pane also reads the session transcript, where an interruption leaves an
`interruptedMessageId`, and watches whether the transcript is growing at all.
Where that frays, and why the thresholds are what they are, is in
[docs/known-issues.md](docs/known-issues.md).

When the sprite is wrong at the wrong moment, `npm run watch` prints the same
decision the pane is making and what it rested on.

## Licence and artwork

The **code** is MIT — see [LICENSE](LICENSE).

The **artwork is not mine and is not covered by it.** The Gen-5 sprites are
Game Freak's; the hand-picked GIFs are fan art found online. They ship with the
project because several entries are only worth having because of them.
[ATTRIBUTION.md](ATTRIBUTION.md) names what came from where, and anything will
be removed on request — sprites are read by path, so it is a one-line change.

Pokémon is a trademark of Nintendo. This is a personal tool, unaffiliated with
anyone, and nothing here is sold.

## More

- [docs/design.md](docs/design.md) — why it is built this way: why it is not in
  the spinner line, how a sprite is scaled down without ruining it, and what a
  terminal can actually draw.
- [docs/known-issues.md](docs/known-issues.md) — where the working/waiting
  detection frays, and the features that are built but deliberately dormant.
