#!/usr/bin/env bash
set -euo pipefail
cd /mnt/c/DEV/MMD-Delivery
export PATH="/home/maladho/.local/bin:/usr/bin:/bin"

echo "=== BRANCH ==="
git branch --show-current
echo "HEAD=$(git rev-parse --short HEAD)"
echo "main=$(git rev-parse --short main)"
echo "origin/main=$(git rev-parse --short origin/main)"

echo "=== POTENTIAL SECRETS / NOISE ==="
git status -u --short | grep -E '\.env|secret|credential|\.tmp/|dependabot|service-account|\.pem|\.p8|\.p12|keystore' || true

echo "=== COUNTS ==="
echo "short_lines=$(git status -u --short | wc -l)"
echo "untracked=$(git ls-files --others --exclude-standard | wc -l)"
echo "modified=$(git diff --name-only | wc -l)"
