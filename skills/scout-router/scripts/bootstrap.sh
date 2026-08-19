#!/usr/bin/env bash
# Create a Scout workspace. Works with no app installed — folder mode is enough.
# Usage: bash bootstrap.sh "<workspace-path>" "<your-name>"
set -euo pipefail

WS="${1:-}"; WHO="${2:-me}"
[ -n "$WS" ] || { echo "usage: bash bootstrap.sh <workspace-path> <your-name>"; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TPL="$(cd "$HERE/../../../workspace-template" && pwd)"

mkdir -p "$WS"
cp -R "$TPL/." "$WS/"
find "$WS" -name '.gitkeep' -delete 2>/dev/null || true
for d in goals territory playbook learnings assistants projects data files _inbox .scout/cache .scout/collections; do
  mkdir -p "$WS/$d"; [ -e "$WS/$d/.gitkeep" ] || touch "$WS/$d/.gitkeep"
done

# personalise the placeholder identity
if [ -f "$WS/me.md" ]; then
  sed -i.bak "s/__NAME__/$WHO/g" "$WS/me.md" && rm -f "$WS/me.md.bak"
fi

# generate the cache and the dedupe list so an agent has something to read on wake
node "$HERE/refresh.mjs" "$WS"

if [ ! -d "$WS/.git" ]; then
  git -C "$WS" init -q
  git -C "$WS" symbolic-ref HEAD refs/heads/main 2>/dev/null || true
  # a fresh machine often has no git identity — set a local one so this never fails
  git -C "$WS" config user.name  "$WHO"
  git -C "$WS" config user.email "${WHO// /.}@scout.local"
  cat > "$WS/.gitignore" <<'GI'
.DS_Store
.scout/index/
.scout/cache/computed.json
_inbox/_done/
GI
  git -C "$WS" add -A && git -C "$WS" commit -q -m "workspace: initial setup for $WHO" || true
fi

cat <<TXT

Workspace ready: $WS

Next:
  1. Open it with your agent and say: "read .scout/cache/context.md and set me up"
     It will interview you and fill in me.md, your goals and your first territory.
  2. After any batch of changes, refresh what your agent reads:
       node "$HERE/refresh.mjs" "$WS"

No app needed. Everything is markdown.
TXT
