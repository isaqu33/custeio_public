#!/usr/bin/env bash
# Take a compressed dump of the Custeio database.
#
# Every organization's stock, recipes and cost history live in MongoDB and
# nowhere else. Losing the volume without one of these files is losing the
# product's record of what it told an owner — so this is the one script that
# has to work on a machine nobody has logged into for months. It therefore
# depends on nothing but `docker` (or a local `mongodump`) and writes a single
# self-contained archive.
#
#   ./scripts/ops/backup-mongo.sh                     # dump into ./backups
#   BACKUP_DIR=/mnt/backups ./scripts/ops/backup-mongo.sh
#   MONGO_CONTAINER=mongo-custeio ./scripts/ops/backup-mongo.sh
#
# Restore drill (do this quarterly, not the day you need it):
#   ./scripts/ops/restore-mongo.sh backups/<file>.gz --db custeio_restore_check --yes
set -euo pipefail

cd "$(dirname "$0")/../.."
[ -f .env ] && set -a && . ./.env && set +a

BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
MONGO_CONTAINER="${MONGO_CONTAINER:-mongo-custeio}"
DB_NAME="${MONGO_DB_NAME:-custeio}"
STAMP="$(date +%Y%m%d-%H%M%S)"
ARCHIVE="${BACKUP_DIR}/custeio-${STAMP}.archive.gz"

mkdir -p "$BACKUP_DIR"

# Credentials come from the same .env the app uses, so a backup cannot drift from
# the database it is meant to protect.
MONGO_USER="${MONGO_USERNAME:-}"
MONGO_PASS="${MONGO_PASSWORD:-}"
if [ -z "$MONGO_USER" ] || [ -z "$MONGO_PASS" ]; then
  echo "ERROR: MONGO_USERNAME / MONGO_PASSWORD are not set (looked in .env)." >&2
  exit 1
fi

dump() {
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$MONGO_CONTAINER"; then
    # --quiet so the archive on stdout is not polluted by progress output.
    docker exec "$MONGO_CONTAINER" mongodump \
      --username "$MONGO_USER" --password "$MONGO_PASS" --authenticationDatabase admin \
      --db "$DB_NAME" --archive --gzip --quiet
  elif command -v mongodump >/dev/null 2>&1; then
    mongodump --uri "${DATABASE_URL}" --archive --gzip --quiet
  else
    echo "ERROR: neither the '$MONGO_CONTAINER' container nor a local mongodump was found." >&2
    exit 1
  fi
}

echo "Dumping '$DB_NAME' → $ARCHIVE"
dump > "$ARCHIVE"

# An empty or truncated archive is worse than no archive, because it looks like a
# backup. Fail loudly instead of leaving one behind.
SIZE=$(wc -c < "$ARCHIVE" | tr -d ' ')
if [ "$SIZE" -lt 1024 ]; then
  echo "ERROR: archive is only ${SIZE} bytes — treating as a failed dump." >&2
  rm -f "$ARCHIVE"
  exit 1
fi

echo "Wrote $(du -h "$ARCHIVE" | cut -f1) to $ARCHIVE"

# Keep the last N. Deliberately simple: offsite copies and longer history are the
# job of whatever syncs $BACKUP_DIR somewhere else — see docs/operations/backup.md.
if [ "$BACKUP_KEEP" -gt 0 ]; then
  ls -1t "${BACKUP_DIR}"/custeio-*.archive.gz 2>/dev/null | tail -n "+$((BACKUP_KEEP + 1))" | while read -r old; do
    echo "Pruning $old"
    rm -f "$old"
  done
fi
