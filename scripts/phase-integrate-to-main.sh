#!/usr/bin/env bash
# Integrate feat/unified-loyalty working tree → commit → merge main → push
set -euo pipefail
cd /mnt/c/DEV/MMD-Delivery
export PATH="/home/maladho/.local/bin:/usr/bin:/bin"

echo "=== PRECHECK ==="
git branch --show-current
test "$(git branch --show-current)" = "feat/unified-loyalty"

# Ignore local noise / secrets
if ! grep -q 'apps/web/\.tmp/' .gitignore 2>/dev/null; then
  printf '\n# Local web probe artifacts\napps/web/.tmp/\napps/web/.env.twilio-audit\ndependabot-alerts.json\ndependabot-crit-high.json\n' >> .gitignore
fi

echo "=== STAGE ==="
git add -A
# Ensure secrets stay out even if previously force-added
git reset HEAD -- \
  apps/web/.env.twilio-audit \
  apps/web/.tmp \
  dependabot-alerts.json \
  dependabot-crit-high.json \
  2>/dev/null || true

echo "=== STAGED SUMMARY ==="
git diff --cached --stat | tail -30
echo "staged_files=$(git diff --cached --name-only | wc -l)"

# Refuse if any obvious secret slipped in
if git diff --cached --name-only | grep -E '(^|/)\.env(\.|$)|service-account|\.pem$|\.p8$|\.p12$|keystore' ; then
  echo "REFUSING: secret-like path staged"
  exit 99
fi

echo "=== COMMIT ON FEAT ==="
git commit -m "$(cat <<'EOF'
feat: integrate loyalty, marketing, finance, analytics and Phase 10.1 stabilization

Bring the full feat/unified-loyalty working tree onto a single commit series:
multi-role loyalty, commissions, subscriptions, MMD+, marketing, analytics,
finance center, empty-DB migration fixes, and Preview readiness validations.
EOF
)"

echo "=== MERGE INTO MAIN ==="
git checkout main
git merge --no-ff feat/unified-loyalty -m "$(cat <<'EOF'
merge: integrate feat/unified-loyalty into main for unified E2E testing

Combine loyalty/finance/marketing/analytics Phase work with Phase 10.1
stabilization so Web, mobile, and Supabase validations run on one codebase.
EOF
)"

echo "=== POST-MERGE ==="
git rev-parse --short HEAD
git log --oneline -5
git status -sb | head -20
