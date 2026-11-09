#!/usr/bin/env bash
# Restore a dump taken by backup-mongo.sh.
#
# Defaults to restoring into a SIDE database (`<db>_restore_check`) rather than over
# the live one, because the common use is proving a backup is real — a backup nobody
# has restored is a hypothesis. Overwriting production is possible, but you have to
# say so out loud.
#
#   ./scripts/ops/restore-mongo.sh backups/custeio-20260825.archive.gz --yes
#   ./scripts/ops/restore-mongo.sh backups/custeio-20260825.archive.gz --db custeio --yes
set -euo pipefail

cd "$(dirname "$0")/../.."
[ -f .env ] && set -a && . ./.env && set +a

ARCHIVE="${1:-}"
shift || true

SOURCE_DB="${MONGO_DB_NAME:-custeio}"
TARGET_DB="${SOURCE_DB}_restore_check"
CONFIRMED=0
MONGO_CONTAINER="${MONGO_CONTAINER:-mongo-custeio}"

while [ $# -gt 0 ]; do
  case "$1" in
    --db) TARGET_DB="$2"; shift 2 ;;
    --yes) CONFIRMED=1; shift ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

if [ -z "$ARCHIVE" ] || [ ! -f "$ARCHIVE" ]; then
  echo "Usage: $0 <archive.gz> [--db <target>] --yes" >&2
  exit 1
fi

echo "Archive : $ARCHIVE"
echo "Into    : $TARGET_DB"
if [ "$TARGET_DB" = "$SOURCE_DB" ]; then
  echo "WARNING : this REPLACES the live database. Collections in the archive are dropped first."
fi
[ "$CONFIRMED" -eq 1 ] || { echo "Refusing to run without --yes."; exit 1; }

MONGO_USER="${MONGO_USERNAME:-}"
MONGO_PASS="${MONGO_PASSWORD:-}"

# `--nsFrom/--nsTo` is what lets the same archive land in a different database, which
# is the whole point of the drill: verify without touching what is live.
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$MONGO_CONTAINER"; then
  docker exec -i "$MONGO_CONTAINER" mongorestore \
    --username "$MONGO_USER" --password "$MONGO_PASS" --authenticationDatabase admin \
    --archive --gzip --drop \
    --nsFrom "${SOURCE_DB}.*" --nsTo "${TARGET_DB}.*" --quiet < "$ARCHIVE"
elif command -v mongorestore >/dev/null 2>&1; then
  mongorestore --uri "${DATABASE_URL}" --archive --gzip --drop \
    --nsFrom "${SOURCE_DB}.*" --nsTo "${TARGET_DB}.*" --quiet < "$ARCHIVE"
else
  echo "ERROR: neither the '$MONGO_CONTAINER' container nor a local mongorestore was found." >&2
  exit 1
fi

echo "Restored into '$TARGET_DB'. Compare it against the source before trusting it:"
echo "  docker exec $MONGO_CONTAINER mongosh -u \$MONGO_USERNAME -p \$MONGO_PASSWORD --authenticationDatabase admin \\"
echo "    --quiet --eval 'const a=db.getSiblingDB(\"$SOURCE_DB\"),b=db.getSiblingDB(\"$TARGET_DB\"); a.getCollectionNames().forEach(c=>print(c, a[c].countDocuments(), b[c].countDocuments()))'"
