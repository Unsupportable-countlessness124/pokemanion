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
import { join, sep } from 'node:path'
import { ROOT } from './config.mjs'
import { SPECIES_ENV, names } from './roster.mjs'
import { chosen } from './agents.mjs'

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

// Installed as a plugin, the project sits in a directory named after its
// version — ~/.claude/plugins/cache/pokemanion/pokemanion/1.1.0. Writing that
// path into someone's shell file would work exactly until the next release
// moved it, leaving a function pointing at a directory that no longer exists
// and nothing around to notice.
export const isPluginRoot = (root = ROOT) => root.includes(`${sep}plugins${sep}cache${sep}pokemanion${sep}`)

// So a plugin install writes a wrapper that finds the project each time instead.
//
// `find` rather than a glob: an unmatched glob is an error in zsh, not an empty
// list, and this has to behave the same in both shells. Newest version wins, and
// an uninstalled plugin resolves to nothing, which the wrapper treats as "not
// installed" and passes every argument straight through.
const RESOLVER = `pokemanion_root() {
  find "$HOME/.claude/plugins/cache/pokemanion" "$HOME/.codex/plugins/cache/pokemanion" \\
       -maxdepth 4 -type f -name run.sh -path "*/bin/run.sh" 2>/dev/null |
    sort -V | tail -1 | sed "s:/bin/run.sh$::"
}`

// One function per agent you have, both inside the same markers.
//
// Not one block each. The markers are the handle on what is already in your
// shell file — install finds the old block by them and replaces it, `--remove`
// finds it to take it out — so a second pair would orphan every existing
// install. That is the bug install.mjs had from matching the project's old
// name, and it is not worth repeating for the sake of tidiness.
export const snippet = (agents = null, portable = isPluginRoot()) => {
  const wrappers = (agents ?? chosen()).map((agent) => agent.name)

  return `${BEGIN}
${wrappers.map((name) => `# Summon a specific one: ${name} --pikachu, ${name} --resume --ash`).join('\n')}
# Or any of the others:  --flygon      (fetched the first time)
# Pick from a list:      --pokemon
# Roll the dice:         --pokerandom
# Remove with: node ${portable ? '"$(pokemanion_root)/src/shell.mjs"' : join(ROOT, 'src', 'shell.mjs')} --remove
${portable ? `${RESOLVER}\n` : ''}
${wrappers.map((name) => wrapper(name, portable)).join('\n\n')}
${END}`
}

const wrapper = (agent, portable = isPluginRoot()) => {
  const residents = names().map((name) => `--${name}`).join('|')

  // Resolved once per launch rather than per lookup: the find costs about 4ms
  // and there are three places that would otherwise each pay it.
  const at = (...parts) => (portable ? `$pixel_runner_root/${parts.join('/')}` : join(ROOT, ...parts))

  return `${agent}() {
  local pixel_runner_species="" pixel_runner_menu="" pixel_runner_random="" pixel_runner_args=() pixel_runner_arg pixel_runner_try pixel_runner_hint${portable ? '\n  local pixel_runner_root="$(pokemanion_root)"' : ''}
  for pixel_runner_arg in "$@"; do
    case "$pixel_runner_arg" in
      --pokemon|--pokemons)
        pixel_runner_menu=1
        ;;
      --pokerandom)
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
        if grep -qi "\\"\${pixel_runner_try}\\"" "${at('assets', 'gen5-names.json')}" 2>/dev/null; then
          pixel_runner_species="$pixel_runner_try"
        else
          pixel_runner_args+=("$pixel_runner_arg")
          # Passed through either way — this only mentions a near miss. It is
          # deliberately quiet: the helper answers at one edit of difference,
          # which is enough for --charizrd and silent for every flag Claude
          # actually has. --version is two edits from Persian, which is exactly
          # the kind of thing that must not be shouted at you on launch.
          pixel_runner_hint=\$("${at('bin', 'run.sh')}" src/hint.mjs "\${pixel_runner_try}" 2>/dev/null)
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

  # --pokerandom beats the menu: asking for a surprise and then being shown a list
  # to choose from would be answering a question nobody asked.
  if [ -n "$pixel_runner_random" ] && [ -z "$pixel_runner_species" ]; then
    pixel_runner_species="$("${at('bin', 'run.sh')}" src/choose.mjs --random)" || return $?
  fi

  # The picker writes the chosen name to stdout and the list to the terminal,
  # so this captures the answer without swallowing what you are reading. A
  # non-zero exit means you backed out, and then Claude should not start either.
  if [ -n "$pixel_runner_menu" ] && [ -z "$pixel_runner_species" ]; then
    pixel_runner_species="$("${at('bin', 'run.sh')}" src/choose.mjs)" || return $?
  fi

  if [ -n "$pixel_runner_species" ]; then
    ${SPECIES_ENV}="$pixel_runner_species" command ${agent} "\${pixel_runner_args[@]}"
  else
    command ${agent} "\${pixel_runner_args[@]}"
  fi
}`
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

// The same install the command line performs, callable from the hook.
//
// A plugin has no setup step to run, so the wrapper is written on its first
// hook instead. Idempotent by construction: the block is found by its markers
// and replaced, so this can run on every session start and only ever produce
// one copy. Returns the file it wrote to, or null if it did nothing.
export const install = (agents = chosen(), rc = RC) => {
  if (agents.length === 0) return null

  const existing = existsSync(rc) ? readFileSync(rc, 'utf8') : ''
  const body = `${withoutBlock(existing).replace(/\s*$/, '')}\n\n${snippet(agents)}\n`

  // Unchanged files are left alone. Rewriting one costs a backup that overwrites
  // the previous backup, and on a plugin this runs at every install and upgrade.
  if (body === existing) return null

  if (existsSync(rc)) copyFileSync(rc, `${rc}.pixel-runner-backup`)

  writeFileSync(rc, body)

  return rc
}

if (process.argv[1] && process.argv[1].endsWith('shell.mjs')) {
  const existing = existsSync(RC) ? readFileSync(RC, 'utf8') : ''

  const agents = chosen()
  const wrappers = agents.map((agent) => agent.name)

  if (process.argv.includes('--remove')) {
    write(withoutBlock(existing))
    console.log(
      `\n  removed from ${RC}\n  open a new terminal, or run: ${wrappers.map((name) => `unset -f ${name}`).join('; ') || 'unset -f claude'}\n`,
    )
  } else if (process.argv.includes('--install')) {
    if (agents.length === 0) {
      console.error('\n  no coding agent found — install Claude Code or Codex first\n')
      process.exit(1)
    }

    const cleaned = withoutBlock(existing).replace(/\s*$/, '')

    write(`${cleaned}\n\n${snippet(agents)}\n`)
    console.log(
      `\n  added to ${RC}  (${wrappers.join(', ')})\n` +
        `  backup at ${RC}.pixel-runner-backup\n\n` +
        `  ${names().slice(0, 4).map((name) => `${wrappers[0]} --${name}`).join('\n  ')}\n  ...and ${names().length - 4} more\n\n` +
        `  open a new terminal, or run: source ${RC}\n`,
    )
  } else {
    console.log(snippet())
  }
}
