#!/bin/bash
# Nexus RMS — start both Angular dev server and nebula-srv Express API
# Usage: ./start.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NEBULA_SRV_DIR="/home/codex/dev/nexus/typescript/nebula-srv"

echo "=== Starting nebula-srv (Express API on :3101) ==="
(cd "$NEBULA_SRV_DIR" && npx tsx src/index.ts) &
SRV_PID=$!

sleep 2
if ! kill -0 $SRV_PID 2>/dev/null; then
  echo "ERROR: nebula-srv failed to start"
  exit 1
fi

echo "=== Starting Angular dev server (on :3000, proxying /api to :3101) ==="
cd "$SCRIPT_DIR"
npx ng serve --proxy-config proxy.conf.json &
NG_PID=$!

cleanup() {
  echo "=== Shutting down ==="
  kill $NG_PID 2>/dev/null
  kill $SRV_PID 2>/dev/null
  exit 0
}
trap cleanup INT TERM

wait
