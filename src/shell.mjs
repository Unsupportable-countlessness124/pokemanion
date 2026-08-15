// `claude --pikachu`, `claude --resume --ash`.
//
// Claude Code owns the `claude` command and would reject an unknown flag, so
// the flag must never reach it. A shell function of the same name gets there
// first: it lifts out any argument naming a Pokemon, passes everything else
// through untouched, and puts the choice in the environment — which Claude Code
// inherits, and so do the hooks it runs, which is how the pane finds out.
//
// Only names in the roster are lifted. Anything else is somebody else's flag
// and is passed along verbatim, so --resume, --continue and the rest are
// unaffected whether they come before or after.
//
// Usage: npm run shell              print the function
//        npm run shell -- --install add it to ~/.zshrc
//        npm run shell -- --remove  take it out again

import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ROOT } from './config.mjs'
import { SPECIES_ENV, names } from './roster.mjs'

// Do not rename these to match the project. They are not a label, they are the
// handle on a block already written into people's ~/.zshrc: install finds the
// old block by these exact strings and replaces it, and `--remove` finds it to
// take it out. Change them and every existing install is orphaned — a second
// claude() function appended below the first, and an uninstall that reports
// success while leaving the original in place.
//
// That is precisely the bug install.mjs had, from matching the project's old
// name, and the reason it is worth a comment rather than a tidy-up.
const BEGIN = '# >>> pixel-runner >>>'
const END = '# <<< pixel-runner <<<'

export const snippet = () => {
  const residents = names().map((name) => `--${name}`).join('|')

  return `${BEGIN}
# Summon a specific one: claude --pikachu, claude --resume --ash
# Or any of the others:  claude --flygon      (fetched the first time)
# Pick from a list:      claude --pokemon
# Roll the dice:         claude --random
# Remove with: node ${join(ROOT, 'src', 'shell.mjs')} --remove
claude() {
  local pixel_runner_species="" pixel_runner_menu="" pixel_runner_random="" pixel_runner_args=() pixel_runner_arg pixel_runner_try pixel_runner_hint
  for pixel_runner_arg in "$@"; do
    case "$pixel_runner_arg" in
      --pokemon|--pokemons)
        pixel_runner_menu=1
        ;;
      --random)
        pixel_runner_random=1
        ;;
      ${residents})
        pixel_runner_species="\${pixel_runner_arg#--}"
        ;;
      --*)
        # Everything the sprite folder has, which is far too many to spell out
        # in a case pattern, so the list is consulted instead. Anything not in
        # it is somebody else's flag and is passed straight through — which is
        # what keeps --resume, --continue and the rest working.
        pixel_runner_try="\${pixel_runner_arg#--}"
        if grep -qi "\\"\${pixel_runner_try}\\"" "${join(ROOT, 'assets', 'gen5-names.json')}" 2>/dev/null; then
          pixel_runner_species="$pixel_runner_try"
        else
          pixel_runner_args+=("$pixel_runner_arg")
          # Passed through either way — this only mentions a near miss. It is
          # deliberately quiet: the helper answers at one edit of difference,
          # which is enough for --charizrd and silent for every flag Claude
          # actually has. --version is two edits from Persian, which is exactly
          # the kind of thing that must not be shouted at you on launch.
          pixel_runner_hint=\$("${join(ROOT, 'bin', 'run.sh')}" src/hint.mjs "\${pixel_runner_try}" 2>/dev/null)
          if [ -n "\$pixel_runner_hint" ]; then
            printf '  pokemanion: no such Pokemon "%s" — did you mean --%s?\\n' "\$pixel_runner_try" "\$pixel_runner_hint" >&2
          fi
        fi
        ;;
      *)
        pixel_runner_args+=("$pixel_runner_arg")
        ;;
    esac
  done

  # --random beats the menu: asking for a surprise and then being shown a list
  # to choose from would be answering a question nobody asked.
  if [ -n "$pixel_runner_random" ] && [ -z "$pixel_runner_species" ]; then
    pixel_runner_species="$("${join(ROOT, 'bin', 'run.sh')}" src/choose.mjs --random)" || return $?
  fi

  # The picker writes the chosen name to stdout and the list to the terminal,
  # so this captures the answer without swallowing what you are reading. A
  # non-zero exit means you backed out, and then Claude should not start either.
  if [ -n "$pixel_runner_menu" ] && [ -z "$pixel_runner_species" ]; then
    pixel_runner_species="$("${join(ROOT, 'bin', 'run.sh')}" src/choose.mjs)" || return $?
  fi

  if [ -n "$pixel_runner_species" ]; then
    ${SPECIES_ENV}="$pixel_runner_species" command claude "\${pixel_runner_args[@]}"
  else
    command claude "\${pixel_runner_args[@]}"
  fi
}
${END}`
}

// Everything between the markers, so installing twice replaces rather than
// stacks and the roster changing is one command away from being picked up.
const withoutBlock = (text) => {
  const from = text.indexOf(BEGIN)

  if (from === -1) return text

  const to = text.indexOf(END, from)

  if (to === -1) return text

  return `${text.slice(0, from)}${text.slice(to + END.length)}`.replace(/\n{3,}/g, '\n\n')
}

// Where the function goes, which is a question about the shell you use rather
// than about the function.
//
// This was hard-coded to ~/.zshrc, and the docs said the wrapper was zsh-only
// on the strength of it. It is not: the same function sources and runs
// identically under bash 3.2, the version macOS ships — arrays, `local`, the
// case patterns, all of it. The only thing that was zsh-only was the filename
// it got written to, so a bash user had it installed into a file their shell
// never reads and concluded the feature did not work.
//
// macOS terminals start login shells, which is why .bash_profile comes before
// .bashrc for bash. An existing file wins over convention either way, since
// that is the one they already put things in.
export const rcFile = (shell = process.env.SHELL ?? '', home = homedir()) => {
  const override = process.argv.find((arg) => arg.startsWith('--rc='))

  if (override) return override.slice('--rc='.length)

  if (/bash/.test(shell)) {
    const profile = join(home, '.bash_profile')

    return existsSync(profile) || !existsSync(join(home, '.bashrc')) ? profile : join(home, '.bashrc')
  }

  return join(home, '.zshrc')
}

const RC = rcFile()

const write = (body) => {
  if (existsSync(RC)) copyFileSync(RC, `${RC}.pixel-runner-backup`)

  writeFileSync(RC, body)
}

if (process.argv[1] && process.argv[1].endsWith('shell.mjs')) {
  const existing = existsSync(RC) ? readFileSync(RC, 'utf8') : ''

  if (process.argv.includes('--remove')) {
    write(withoutBlock(existing))
    console.log(`\n  removed from ${RC}\n  open a new terminal, or run: unset -f claude\n`)
  } else if (process.argv.includes('--install')) {
    const cleaned = withoutBlock(existing).replace(/\s*$/, '')

    write(`${cleaned}\n\n${snippet()}\n`)
    console.log(
      `\n  added to ${RC}\n` +
        `  backup at ${RC}.pixel-runner-backup\n\n` +
        `  ${names().map((name) => `claude --${name}`).join('\n  ')}\n\n` +
        `  open a new terminal, or run: source ${RC}\n`,
    )
  } else {
    console.log(snippet())
  }
}
