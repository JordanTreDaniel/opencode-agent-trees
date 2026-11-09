#!/bin/sh
set -eu
if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo "usage: $0 <key>" >&2
  exit 2
fi
key=$1
case "$key" in *[!A-Za-z0-9._-]*|'') echo "invalid key" >&2; exit 2;; esac
state_dir="/tmp/opencode-demo-wait/$key"
mkdir -p "$state_dir"
if [ -f "$state_dir/done" ]; then
  echo "$key: already done"
  exit 0
fi
if [ ! -f "$state_dir/start" ]; then
  date +%s > "$state_dir/start.tmp"
  mv "$state_dir/start.tmp" "$state_dir/start"
fi
start=$(cat "$state_dir/start")
target=$((start + 150))
echo "$key: waiting until epoch $target"
while :; do
  now=$(date +%s)
  remaining=$((target - now))
  if [ "$remaining" -le 0 ]; then
    : > "$state_dir/done.tmp"
    mv "$state_dir/done.tmp" "$state_dir/done"
    echo "$key: done"
    exit 0
  fi
  if [ "$remaining" -gt 15 ]; then remaining=15; fi
  sleep "$remaining"
done
