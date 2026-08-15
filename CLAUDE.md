# pokemanion

A Pokémon lives in a terminal pane beside every Claude Code session. It rests
while Claude is waiting on you and animates while Claude is working, so you can
tell what a session is doing from across the room without reading the screen.

14 ship with it, 1252 more can be summoned by name, and there is a Pokédex.

**macOS + Ghostty only.** It draws sprites using the kitty graphics protocol and
opens the split by driving Ghostty through AppleScript. It needs `chafa`
(`brew install chafa`) and Ghostty in `/Applications`.

## If the user wants to install it

If `chafa` or Ghostty are missing, run **`npm run deps`** first — it installs
both via Homebrew. Then run **`npm run setup`**, which is the whole install: it
checks the prerequisites, downloads the sprites, renders them, registers the
hooks in `~/.claude/settings.json`, adds a `claude()` wrapper to `~/.zshrc`, and
sets the Ghostty resize keybind the pane needs. Safe to run more than once.

Then tell them the things the script cannot do for them:

1. **Restart Claude Code** — it reads the hooks at startup.
2. **Restart Ghostty** — it reads its config at startup.
3. **Open a new terminal**, or `source ~/.zshrc`.
4. **System Settings → Privacy & Security → Accessibility → enable Ghostty.**
   Opening a split means pressing keys, and macOS blocks that until allowed.
   Without it no pane appears at all.

If it fails, `npm run doctor` checks every piece individually and says which one
is unhappy. `npm run uninstall-statusline` and `npm run shell -- --remove` undo
the two things that touch files outside this repo.

## Using it

Typed at Claude, mid-session — a hook answers these and blocks the prompt, so
they reach no model and cost no tokens:

- `--squirtle` — switch the pane to any of the 1252, live
- `--random`, `--pokemon` — roll one, or list the residents
- `--dex pikachu`, `--dex ghost`, `--dex current`, `--dex random` — look things up

Send them while Claude is **idle**. Text typed while a turn is already running
never fires the hook — Claude Code folds it into the running turn — so it
reaches the model as an ordinary message and the pane does not change.

At launch, via the shell wrapper: `claude --pikachu`, `claude --random`,
`claude --resume --charizard`.

## Working on the code

- `npm test` — the smoke suite, and the bar for a change being finished.
- `npm run watch` — prints the working/waiting decision the pane is making, live.
- Two docs carry the reasoning, and are worth reading before changing behaviour:
  [docs/design.md](docs/design.md) for why it is built this way, and
  [docs/known-issues.md](docs/known-issues.md) for what is deliberately wrong.
- The pane is a long-lived process. Editing a file changes nothing about a pane
  already drawing — that has cost real time more than once.
