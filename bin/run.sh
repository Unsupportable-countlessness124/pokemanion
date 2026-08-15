#!/bin/sh
# Runs one of our scripts with whatever node is on the machine.
#
# Hooks and the status line are launched with a trimmed PATH and no controlling
# terminal, so `#!/usr/bin/env node` cannot be relied on. Check the usual
# install locations first, then fall back to PATH.
#
# Usage: run.sh <script-name.mjs>
#
# If node is missing we exit quietly. A status line that fails is better than a
# status line that prints an error into the user's interface every second.

script_name=$1
[ -n "$script_name" ] || exit 0
shift

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

node_bin=
if [ -n "$PIXEL_RUNNER_NODE" ] && [ -x "$PIXEL_RUNNER_NODE" ]; then
  node_bin=$PIXEL_RUNNER_NODE
fi

# The node that ran the installer, written down at the time.
#
# Guessing at install locations only works for people who installed node the way
# the guesser expected. Under nvm — which is most people — node lives in a
# version-numbered directory that changes when you upgrade, and there is no
# stable path to hard-code: nvm does not create the `current` symlink this used
# to look for. On a machine with nvm and no system node, every fallback below
# missed, `command -v node` found nothing because hooks run with a trimmed PATH,
# and run.sh exited 0 having done nothing at all. Every hook silently became a
# no-op and the sprite just never moved.
#
# So setup records the interpreter it was itself running under. That is the one
# path guaranteed to be right, because node proved it by executing.
if [ -z "$node_bin" ] && [ -r "$script_dir/../.state/node-path" ]; then
  recorded=$(cat "$script_dir/../.state/node-path" 2>/dev/null)
  [ -n "$recorded" ] && [ -x "$recorded" ] && node_bin=$recorded
fi

if [ -z "$node_bin" ]; then
  for candidate in \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    /usr/bin/node \
    "$HOME/.local/bin/node" \
    "$HOME/.volta/bin/node" \
    "$HOME/.nvm/versions/node/current/bin/node"
  do
    if [ -x "$candidate" ]; then
      node_bin=$candidate
      break
    fi
  done
fi

# Last resort before PATH: any nvm or fnm install at all, newest first. Covers
# the machine where the recorded path has since been uninstalled.
if [ -z "$node_bin" ]; then
  for candidate in $(ls -d "$HOME"/.nvm/versions/node/*/bin/node "$HOME"/.local/share/fnm/node-versions/*/installation/bin/node 2>/dev/null | sort -rV)
  do
    if [ -x "$candidate" ]; then
      node_bin=$candidate
      break
    fi
  done
fi

[ -n "$node_bin" ] || node_bin=$(command -v node 2>/dev/null)
[ -n "$node_bin" ] || exit 0

# A bare name is one of ours in bin/; anything with a slash is relative to the
# project, so the shell function can reach src/choose.mjs through the same node
# hunt the hooks rely on.
case "$script_name" in
  */*) script_path=$script_dir/../$script_name ;;
  *)   script_path=$script_dir/$script_name ;;
esac

exec "$node_bin" "$script_path" "$@"
