#!/usr/bin/env bash
# Phase 10.1 — local-only supabase db reset
set -uo pipefail
cd /mnt/c/DEV/MMD-Delivery
export PATH="/home/maladho/.local/bin:/usr/bin:/bin"

SB=/home/maladho/.local/bin/supabase
echo "=== VERSION ==="
"$SB" --version

echo "=== STATUS ==="
"$SB" status 2>&1 | tee /tmp/mmd-sb-status2.txt | tail -50
echo STATUS_EXIT:$?

# Hard guard: refuse linked remote push patterns
if grep -qiE 'aws|supabase\.co|prod' /tmp/mmd-sb-status2.txt 2>/dev/null; then
  # Local status may still mention images from ECR — that's OK.
  # Refuse only if DB URL points off-localhost.
  if grep -E 'DB URL|Database URL' /tmp/mmd-sb-status2.txt | grep -viE '127\.0\.0\.1|localhost' ; then
    echo "REFUSING: non-local DB URL detected"
    exit 99
  fi
fi

echo "=== CONFIRM LOCAL PORTS ==="
docker ps --format '{{.Names}} {{.Ports}}' | grep supabase_db_MMD-Delivery

echo "=== DB RESET START ==="
# Local only — never --linked
set +e
"$SB" db reset 2>&1 | tee /tmp/mmd-db-reset.txt
RESET_EXIT=${PIPESTATUS[0]}
set -e
echo RESET_EXIT:${RESET_EXIT}
tail -80 /tmp/mmd-db-reset.txt
