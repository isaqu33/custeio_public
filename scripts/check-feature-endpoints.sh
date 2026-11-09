#!/usr/bin/env bash
set -euo pipefail

# Enforce that UI/client code does not hardcode '/api/*' endpoints.
# Allowed source of truth is app/lib/features.ts (+ helper wrappers).

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PATTERN="(apiFetch|fetch)\([[:space:]]*['\"\`]/api/"

# grep, not ripgrep: rg is not guaranteed on dev machines or CI, and when it is
# absent this check silently "passes" (missing command → the `if` sees non-zero →
# skips the error). grep is portable. The ripgrep `-g` globs are reproduced by
# --include (only source files) + a post-filter that drops the api routes and the
# features.ts source of truth, which grep cannot express as a single path glob.
matches="$(grep -rnE "$PATTERN" app components hooks \
  --include='*.ts' --include='*.tsx' --include='*.js' --include='*.jsx' \
  --exclude='*.test.*' --exclude='*.spec.*' 2>/dev/null \
  | grep -v -E '^(app/api/|app/lib/features\.ts:)' || true)"

if [[ -n "$matches" ]]; then
  echo "$matches"
  echo
  echo "ERROR: Found raw '/api/*' endpoint usage."
  echo "Use endpointFor(AppFeature.*) from app/lib/features instead."
  exit 1
fi

echo "Feature endpoint check passed."
