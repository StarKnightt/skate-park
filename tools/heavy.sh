#!/usr/bin/env bash
# Run a heavy job (browser test/recording, Blender, production build, ffmpeg) while holding the single global lock.
# usage: bash tools/heavy.sh <owner> <command...>
# Waits until no other heavy job runs. Breaks a stale lock older than 25 minutes.
LOCK=/c/Code/skate-park/.agent-notes/heavy.lock
owner="$1"; shift
while ! mkdir "$LOCK" 2>/dev/null; do
  if [ -f "$LOCK/owner" ] && [ $(( $(date +%s) - $(stat -c %Y "$LOCK/owner") )) -gt 1500 ]; then
    echo "[heavy] breaking stale lock: $(cat "$LOCK/owner")"; rm -rf "$LOCK"; continue
  fi
  sleep 8
done
echo "$owner $(date +%T) $*" > "$LOCK/owner"
trap 'rm -rf "$LOCK"' EXIT
"$@"
