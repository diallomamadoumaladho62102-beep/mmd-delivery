#!/usr/bin/env bash
set -uo pipefail
cd /mnt/c/DEV/MMD-Delivery
DBNAME=postgres
CONTAINER=supabase_db_MMD-Delivery

run_sql() {
  local name="$1"
  local file="$2"
  echo "=== SQL TEST: $name ==="
  set +e
  docker exec -i "$CONTAINER" psql -U postgres -d "$DBNAME" -v ON_ERROR_STOP=1 < "$file" \
    > "/tmp/mmd-sql-${name}.txt" 2>&1
  local rc=$?
  set -e
  echo "EXIT:${rc}"
  if [[ $rc -eq 0 ]]; then
    echo "PASS:$name"
    return 0
  fi
  echo "FAIL:$name"
  tail -40 "/tmp/mmd-sql-${name}.txt"
  return 1
}

echo "=== LOCAL GUARD ==="
docker exec "$CONTAINER" psql -U postgres -d postgres -Atc "select current_database();"
docker exec "$CONTAINER" psql -U postgres -d postgres -Atc "select count(*) from supabase_migrations.schema_migrations;"
docker exec "$CONTAINER" psql -U postgres -d postgres -Atc "select version from supabase_migrations.schema_migrations order by version desc limit 8;"

pass=0
fail=0
for pair in \
  "loyalty:supabase/tests/mmd_loyalty_finalization.test.sql" \
  "marketing:supabase/tests/mmd_marketing_finalization.test.sql" \
  "finance:supabase/tests/mmd_finance_center.test.sql" \
  "phase10:supabase/tests/mmd_phase_10_stabilization.test.sql"
do
  name="${pair%%:*}"
  file="${pair#*:}"
  if run_sql "$name" "$file"; then
    pass=$((pass+1))
  else
    fail=$((fail+1))
  fi
done

echo "SQL_PASS:${pass} SQL_FAIL:${fail}"
exit $([[ $fail -eq 0 ]] && echo 0 || echo 1)
