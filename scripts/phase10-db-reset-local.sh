#!/usr/bin/env bash
set -uo pipefail
cd /mnt/c/DEV/MMD-Delivery
export PATH="/home/maladho/.local/bin:/usr/bin:/bin"
SB=/home/maladho/.local/bin/supabase

echo "=== VERSION ==="
"$SB" --version

echo "=== STATUS ==="
"$SB" status 2>&1 | tee /tmp/mmd-sb-status3.txt | tail -30
echo STATUS_EXIT:$?

# Guard: must be local 127.0.0.1:54322
if ! grep -q '127.0.0.1:54322' /tmp/mmd-sb-status3.txt; then
  echo "REFUSING: local DB URL 127.0.0.1:54322 not found in status"
  exit 99
fi

echo "=== DB RESET LOCAL ONLY ==="
set +e
"$SB" db reset > /tmp/mmd-db-reset3.txt 2>&1
RESET_EXIT=$?
set -e
echo RESET_EXIT:${RESET_EXIT}
grep -E 'ERROR:|Finished supabase db reset|Applying migration' /tmp/mmd-db-reset3.txt | tail -50
echo "=== TAIL ==="
tail -40 /tmp/mmd-db-reset3.txt
