# Known issues

Things that are wrong on purpose, or wrong and not yet worth fixing. Written
down so the next person does not rediscover them as bugs.

## Working/waiting detection is inference, not a signal

`isWorking()` in `src/window.mjs` decides whether Claude is busy. It is right in
normal use, but it is guessing, and it is worth knowing where the guess frays.

The root cause of all of it: **Claude Code has no interrupt hook.** It rings a
bell when you submit a prompt, before and after each tool, and when a turn ends
cleanly. It says nothing when you press escape, nothing when you walk away from
a permission prompt, and nothing when it asks you a question and waits. Those
endings have to be inferred from traces Claude happens to leave behind.

Give Claude Code an interrupt event and steps 2-4 below collapse into one bell.

### 1. A long quiet stretch reads as finished

If nothing is written to the transcript for `idleAfterMs` (20s) and no tool is
in flight, the sprite settles — even if Claude is still thinking or still
waiting on a slow API response.

20s was picked off a measured 15.6s gap inside one real thinking block, so it
has headroom, but it is headroom over one measurement rather than a guarantee.

The threshold is a straight trade and cannot be tuned out:

- lower  -> escapes settle sooner, but the sprite settles mid-thought
- higher -> no mid-thought flicker, but the fallback path takes longer

It was 4000 once, which flickered constantly.

### 2. Escape during a long tool can hang for up to two minutes

The quiet check is suspended while a tool is in flight, because a slow command
legitimately writes nothing for as long as it runs, so silence there proves
nothing. If the interruption marker fails to land during a long tool call,
nothing catches it until `workingTimeoutMs` (2 min).

In practice the marker does land and the sprite settles in about a second. This
is the fallback being slow, not the normal path.

### 3. Escape detection rides on an undocumented field

Pressing escape appends an `interruptedMessageId` to the session transcript.
That is an internal detail of Claude Code's transcript format and nobody has
promised to keep it.

If it is ever renamed, **nothing errors**. Escape detection silently degrades to
the 20-second quiet rule in issue 1, and the only symptom is the sprite taking
20s to settle instead of 1s. If that is ever the complaint, look here first:
grep a fresh transcript for the field before assuming the logic broke.

### What is solid

The case that prompted all of this — press escape, sprite stands still in about
a second, and stays still until you send something new — is covered by the
marker, verified end to end, and has a seven-case regression suite behind it.

## Commands typed mid-turn go to Claude instead

`--squirtle` and the rest are caught by the `UserPromptSubmit` hook, which fires
when a prompt is submitted. Text typed while Claude is **already working** never
fires it — Claude Code folds that text into the turn already in flight rather
than treating it as a new prompt.

So the same keystrokes mean two different things depending on timing:

| when | what happens |
| --- | --- |
| Claude is idle | the hook answers, the prompt is blocked, the pane switches, no tokens spent |
| Claude is working | the text reaches the model as an ordinary message and it replies about Squirtle |

Nothing breaks and nothing is lost — the pane simply does not change, and you get
an answer where you wanted an action.

**There is no fix from this side.** The hook cannot run for an event that is
never emitted, and there is no other event carrying mid-turn text. Anything that
looked like a fix would mean reading the transcript and racing the model for a
message it is already answering.

The one thing that would close it is Claude Code firing `UserPromptSubmit` for
mid-turn input, or emitting any event at all that carries it. Same shape as the
missing interrupt hook above: the information exists, nothing hands it over.

## The working animation is the same motion in a different palette

The working sprite is the resting sprite's **shiny** form. That fixes quality —
it is literally the same file recoloured, so it cannot be smaller, blurrier or
in a clashing style — but it means the two halves **move identically**. Only the
colour changes.

That is a real limitation, not an oversight. Gen 5 drew exactly two animations
per Pokemon, the front sprite and the back one, and everything else that offers
more loses on quality:

- PMDCollab — 18-31px magnified 2.5-3.6x, 3-12 frames. Blobby, thick outline.
- Showdown's XY set — more pixels than Gen 5, but 3D renders: pale and soft
  beside drawn pixel art.
- The Gen-5 back sprite — perfect quality, but the Pokemon faces away.

Where identical motion is not enough, give the entry a `busy` file of its own.
Psyduck has one and it overrides everything.

Two entries are named for an earlier stage: **Haunter** and **Munchlax**, from
when the working sprite was the evolved form. They were kept because they read
well. `claude --gengar` and `claude --snorlax` are therefore not species names;
the flags are `--haunter` and `--munchlax`. Reinstall the shell function after
any roster rename or the old names stay baked into `~/.zshrc`:

```sh
npm run shell -- --install
```

Pikachu and Ash are exempt from all of this: both halves were hand-picked, and
they are not to be changed.

## Evolution is built but deliberately unused

`becomes` in `src/roster.mjs`, `evolveFrames` and the cached `ghost` silhouette
in `src/window.mjs` are a complete, working evolution transition: the two shapes
traded back and forth as white silhouettes, accelerating 130ms to 40ms, landing
on the new form. It was wired to the waiting/working switch and then unwired.

**Do not delete it.** It is being saved for a different idea — a session that
has run long enough evolves the Pokemon sitting beside it — where the moment is
worth more than it would be as a busy indicator.

Nothing in the roster sets `becomes`, so `transitionFor` never returns `evolve`
and that half never plays. To use it, set `becomes` on an entry and give the
pane a third sprite to flicker towards.

The `flash` half of the same machinery *is* live — it is what plays when a
shiny takes over — so the silhouettes, the cache field and the frame scheduling
are all exercised daily. Only the two-silhouette sequence is dormant.

Two things that bit once and would bite again:

- The alternation **must** have an even step count, or it ends on the shape it
  is leaving and the hard cut it exists to hide happens on the next frame.
- The cache key must change when the cached object gains a field, or old entries
  are still hits and come back missing it — silently. That is what
  `CACHE_VERSION` is for.

## Relative sizing only applies to comparable sprites

Two sprites of different native heights are drawn at different heights, bottom
aligned so they share a floor. But native height only means the same thing for
both when both were drawn at the same scale.

Pikachu's pair is 40px of pixel art beside 285px of smooth animation with no
recoverable pixel grid — the same character at wildly different resolutions.
Dividing one by the other says `0.14`, as if Pikachu shrank to a seventh of
himself, and an early version duly rendered him three rows tall instead of four.

So a ratio below `RELATIVE_FLOOR` (0.8) is read as "not comparable" and both
sprites get the full pane, which is what keeps Pikachu and Ash exactly as they
were. Only genuinely close sizes are treated as a real size difference.

## Gen 7 onward is patchy

The sprite folder carries well past Gen 5's 649, because Smogon kept drawing in
the Black/White style. But it is not complete, and the gap has now been counted
rather than sampled: **159 species exist with no Gen 5 sprite**, all of them
Gen 6 or later.

| generation | missing |
| --- | ---: |
| 6 | 18 |
| 7 | 14 |
| 8 | 32 |
| 9 | 95 |

Gen 9 is where it thins out badly — most of Paldea was never drawn. Decidueye,
Cinderace, Meowscarada and Urshifu are all among them.

Those names are listed in `assets/no-gen5-sprite.json`, so asking for one
answers *"Urshifu — #892, no data: real, but never drawn as a Gen 5 sprite"*
rather than "no such one", which would read as a spelling mistake. The list is
generated by diffing the national dex against the names this project resolves,
and is checked against the roster by `npm test` so the two can never overlap.

`npm run roster` reports a miss rather than failing quietly, so fetch a new
entry before believing in it.
