---
name: A sprite
about: Suggest an animation for a Pokemon, or a Pokemon worth adding
title: 'sprite: '
labels: sprite
---

**Which Pokemon, and which half** — the one that rests, or the one that works?

**Where it came from.** A link if there is one. If you drew it, say so.

**How it measures.** The bar is a scale of 1.8x or less and 24 frames or more at
the size the pane draws, roughly 68 pixels tall. `docs/design.md` explains how to
check, and why file size is no guide — a 500x500 GIF that is really 40x39 blown
up is pixel art and scales beautifully, while a smooth render of the same size
turns to mush.

Worth checking before you post:

- [ ] one character in the frame, not a battle scene
- [ ] it moves more than the resting sprite does
- [ ] the palette is close to its partner, or `npm run recolour` can bring it in
