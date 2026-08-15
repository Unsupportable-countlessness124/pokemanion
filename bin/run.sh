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
else
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
