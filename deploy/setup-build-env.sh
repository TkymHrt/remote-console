#!/bin/sh
set -eu

runtime=/opt/remote-console/runtime/bin
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ "$(id -u)" -eq 0 ]; then
  printf '%s\n' 'Run build environment setup as the deployment user, not root.' >&2
  exit 1
fi
test -x "$runtime/node" || { printf '%s\n' 'Install the production Node runtime first.' >&2; exit 1; }
install -d -m 0755 "$HOME/.local/bin"
if [ -e "$HOME/.local/bin/node" ] && [ ! -L "$HOME/.local/bin/node" ]; then
  printf '%s\n' 'A user-managed Node executable already exists; refusing to replace it.' >&2
  exit 1
fi
ln -sfn "$runtime/node" "$HOME/.local/bin/node"
export PATH="$HOME/.local/bin:$runtime:$PATH"
version=$(node -p "JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8')).devEngines.packageManager.version" "$root/package.json")
if ! command -v pnpm >/dev/null 2>&1 || [ "$(pnpm --version)" != "$version" ]; then
  npm install --global --prefix "$HOME/.local" "pnpm@$version"
fi
node --version
pnpm --version
printf '%s\n' 'Build tools are in ~/.local/bin. Start a new SSH login or export PATH="$HOME/.local/bin:$PATH".'
