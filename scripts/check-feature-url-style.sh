#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

FILE="app/lib/features.ts"

errors=0

# Extract string literals from FEATURE_ENDPOINT mapping lines:
#   [AppFeature.X]: '/api/...'
while IFS= read -r endpoint; do
  if [[ ! "$endpoint" =~ ^/api/[][[:alnum:]_-]+(/[][[:alnum:]_-]+)*$ ]]; then
    echo "ERROR: invalid endpoint format: $endpoint"
    errors=1
  fi

done < <(grep -oE ":[[:space:]]*'/api/[^']+'" "$FILE" | sed -E "s/^.*'([^']+)'.*$/\1/")

if [[ "$errors" -ne 0 ]]; then
  exit 1
fi

echo "Feature URL style check passed."
