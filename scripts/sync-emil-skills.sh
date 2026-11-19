#!/usr/bin/env bash
# Re-vendors github.com/emilkowalski/skills into .agents/skills (skills) and .agents/emil-skills (license, docs, upstream commit).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git clone -q --depth 1 https://github.com/emilkowalski/skills "$TMP/skills"
SRC="$TMP/skills"
mkdir -p "$ROOT/.agents/skills"
for d in "$SRC"/skills/*/; do
  name="$(basename "$d")"
  rm -rf "$ROOT/.agents/skills/$name"
  cp -R "$d" "$ROOT/.agents/skills/$name"
done
META="$ROOT/.agents/emil-skills"
rm -rf "$META" && mkdir -p "$META"
cp "$SRC"/LICENSE "$SRC"/README.md "$SRC"/*-cheatsheet.md "$META"/
ls "$SRC/skills" > "$META/SKILLS.txt"
{
  echo "source: https://github.com/emilkowalski/skills"
  echo "commit: $(git -C "$SRC" rev-parse HEAD)"
  echo "commit_date: $(git -C "$SRC" log -1 --format=%cI)"
} > "$META/UPSTREAM"
echo "Synced $(wc -l < "$META/SKILLS.txt") skills at $(git -C "$SRC" rev-parse --short HEAD)"
