#!/usr/bin/env bash
set -euo pipefail
cd /mnt/c/DEV/MMD-Delivery

echo "=== FIND SUPABASE CLI ==="
ls -la node_modules/.bin/supabase 2>/dev/null || true
ls -la "$HOME"/.local/bin/supabase 2>/dev/null || true
ls -la /opt/homebrew/bin/supabase 2>/dev/null || true
command -v supabase || true

echo "=== DOCKER EXEC DB PROBE ==="
docker exec supabase_db_MMD-Delivery psql -U postgres -d postgres -c "select current_database() as db, inet_server_port() as port;"
docker exec supabase_db_MMD-Delivery psql -U postgres -d postgres -Atc "select count(*) from supabase_migrations.schema_migrations;" || echo "NO_MIGRATIONS_TABLE"
docker exec supabase_db_MMD-Delivery psql -U postgres -d postgres -Atc "select version from supabase_migrations.schema_migrations order by version desc limit 12;" || true

mkdir -p /tmp/mmd-local-db-backup
docker exec supabase_db_MMD-Delivery psql -U postgres -d postgres -Atc "select version from supabase_migrations.schema_migrations order by version" \
  > /tmp/mmd-local-db-backup/schema_migrations.txt || true
docker exec supabase_db_MMD-Delivery psql -U postgres -d postgres -Atc "select schemaname||'.'||tablename from pg_tables where schemaname='public' order by 1" \
  > /tmp/mmd-local-db-backup/public_tables.txt || true
wc -l /tmp/mmd-local-db-backup/* || true
echo BACKUP_DONE
