#!/bin/bash
# Keeps the sniper alive: restarts it if it ever exits unexpectedly.
cd "$(dirname "$0")" || exit 1
mkdir -p data
while true; do
  echo "[run.sh] starting sniper at $(date)"
  node src/index.js
  code=$?
  if [ $code -eq 0 ]; then
    echo "[run.sh] clean exit, stopping"
    break
  fi
  echo "[run.sh] exited with code $code — restarting in 15s"
  sleep 15
done
