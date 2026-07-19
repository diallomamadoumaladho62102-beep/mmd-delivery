#!/usr/bin/env bash
set -uo pipefail
cd /mnt/c/DEV/MMD-Delivery
export PATH="/home/maladho/.nvm/versions/node/v20.20.2/bin:/home/maladho/.local/share/pnpm:/home/maladho/.local/bin:$PATH"

echo "=== CRON FANOUT UNIT ==="
(cd apps/web && pnpm run test:cron-fanout)
echo "CRON_UNIT_EXIT:$?"

echo "=== TARGETED UNIT (auth/lock related) ==="
(cd apps/web && pnpm exec tsx src/lib/cronAuth.test.ts)
echo "CRON_AUTH_EXIT:$?"
(cd apps/web && pnpm exec tsx src/lib/cronJobLock.test.ts)
echo "CRON_LOCK_EXIT:$?"

echo "=== WEB BUILD ==="
(cd apps/web && pnpm run build) > /tmp/mmd-cron-build.txt 2>&1
echo "WEB_BUILD_EXIT:$?"
tail -30 /tmp/mmd-cron-build.txt

echo "=== APPLY LOCAL MIGRATION IF DOCKER UP ==="
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q supabase_db_MMD-Delivery; then
  if command -v supabase >/dev/null 2>&1; then
    supabase migration up --local > /tmp/mmd-mig-up.txt 2>&1 || true
    tail -20 /tmp/mmd-mig-up.txt
  fi
  bash scripts/phase10-run-sql-tests.sh
  echo "SQL_EXIT:$?"
else
  echo "SQL_SKIPPED:no_local_db"
fi

echo "CRON_VALIDATE_DONE"
