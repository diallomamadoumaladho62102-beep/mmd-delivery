#!/usr/bin/env bash
set -euo pipefail
cd /mnt/c/DEV/MMD-Delivery

echo "=== ENV ==="
pwd
git branch --show-current
node -v
pnpm -v || true

SB=(npx --yes supabase@2.109.1)
echo "=== SUPABASE VERSION ==="
"${SB[@]}" --version

echo "=== DOCKER LOCAL CONTAINERS ==="
docker ps --format '{{.Names}} {{.Status}}' | grep -i supabase || true

echo "=== SUPABASE STATUS ==="
set +e
"${SB[@]}" status > /tmp/mmd-sb-status.txt 2>&1
STATUS_EXIT=$?
set -e
tail -60 /tmp/mmd-sb-status.txt
echo "STATUS_EXIT:${STATUS_EXIT}"

# Confirm local only: DB on 54322
echo "=== LOCAL DB IDENTITY ==="
export PGPASSWORD="${PGPASSWORD:-postgres}"
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
select current_database() as db,
       inet_server_port() as port,
       current_setting('server_version') as pg_version;
select count(*) as migration_rows from supabase_migrations.schema_migrations;
select version from supabase_migrations.schema_migrations order by version desc limit 15;
SQL

echo "=== BACKUP MIGRATION LIST ==="
mkdir -p /tmp/mmd-local-db-backup
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc \
  "select version from supabase_migrations.schema_migrations order by version" \
  > /tmp/mmd-local-db-backup/schema_migrations.txt
psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -Atc \
  "select schemaname||'.'||tablename from pg_tables where schemaname='public' order by 1" \
  > /tmp/mmd-local-db-backup/public_tables.txt
wc -l /tmp/mmd-local-db-backup/*

echo "=== CONFIRM NOT LINKED / NOT PRODUCTION ==="
# Refuse if any production-looking host is configured as linked
if [[ -f supabase/.temp/project-ref ]]; then
  echo "project-ref present:"
  cat supabase/.temp/project-ref
else
  echo "no supabase/.temp/project-ref (good for local-only)"
fi
