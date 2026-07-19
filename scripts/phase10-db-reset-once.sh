#!/usr/bin/env bash
# Loop local db reset, print failing migration, stop after success or N fails.
set -uo pipefail
cd /mnt/c/DEV/MMD-Delivery
export PATH="/home/maladho/.local/bin:/usr/bin:/bin"
SB=/home/maladho/.local/bin/supabase
MAX=${1:-8}

for i in $(seq 1 "$MAX"); do
  echo "===== ATTEMPT $i/$MAX ====="
  set +e
  "$SB" db reset > /tmp/mmd-db-reset-loop.txt 2>&1
  RC=$?
  set -e
  echo RESET_EXIT:${RC}
  if [[ $RC -eq 0 ]]; then
    echo "SUCCESS on attempt $i"
    tail -20 /tmp/mmd-db-reset-loop.txt
    exit 0
  fi
  echo "--- ERROR CONTEXT ---"
  grep -n "ERROR:" /tmp/mmd-db-reset-loop.txt | tail -5
  grep -n "Applying migration" /tmp/mmd-db-reset-loop.txt | tail -8
  # Stop so human/agent can fix; do not auto-edit.
  exit "$RC"
done
