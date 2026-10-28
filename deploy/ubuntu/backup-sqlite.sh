#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

TEST_MODE="${MOMENTUM_DEPLOY_TEST_MODE:-0}"
TEST_ROOT=""
if [[ "$TEST_MODE" == 1 ]]; then
  TEST_ROOT="${MOMENTUM_DEPLOY_TEST_ROOT:-}"
  if [[ ! "$TEST_ROOT" =~ ^/tmp/momentum-deploy-drill\.[A-Za-z0-9]{6}$ || ! -d "$TEST_ROOT" || -L "$TEST_ROOT" ]]; then
    echo "Test mode requires a private /tmp/momentum-deploy-drill.XXXXXX directory." >&2; exit 2
  fi
  [[ "$(cd -- "$TEST_ROOT" && pwd -P)" == "$TEST_ROOT" && "$(stat -c '%u:%a' "$TEST_ROOT")" == "$(id -u):700" ]] || { echo "Unsafe isolated test root." >&2; exit 2; }
  SERVICE_USER="$(id -un)"
  BACKUP_OWNER="$(id -un)"
  BACKUP_GROUP="$(id -gn)"
  EXPECTED_DB="$TEST_ROOT/data/momentum.sqlite"
  EXPECTED_KEY="$TEST_ROOT/data/.app-encryption-key"
  EXPECTED_DOCS="$TEST_ROOT/data/documents"
  EXPECTED_STAGING="$TEST_ROOT/data"
  EXPECTED_DEST="$TEST_ROOT/backups"
  [[ "${DATABASE_FILE:-$EXPECTED_DB}" == "$EXPECTED_DB" && "${APP_ENCRYPTION_KEY_FILE:-$EXPECTED_KEY}" == "$EXPECTED_KEY" && "${DOCUMENT_STORAGE_DIR:-$EXPECTED_DOCS}" == "$EXPECTED_DOCS" ]] || { echo "Test database/key/document paths must remain inside the isolated test directory." >&2; exit 2; }
  [[ "${BACKUP_STAGING_DIR:-$EXPECTED_STAGING}" == "$EXPECTED_STAGING" && "${BACKUP_DIR:-$EXPECTED_DEST}" == "$EXPECTED_DEST" ]] || { echo "Test backup paths must remain inside the isolated test directory." >&2; exit 2; }
  if [[ -n "${MOMENTUM_DEPLOY_TEST_BACKUP_STAMP:-}" && ! "${MOMENTUM_DEPLOY_TEST_BACKUP_STAMP}" =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; then echo "Invalid isolated test backup timestamp." >&2; exit 2; fi
else
  [[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "Run with sudo: sudo bash deploy/ubuntu/backup-sqlite.sh" >&2; exit 1; }
  SERVICE_USER="${MOMENTUM_SERVICE_USER:-momentum}"
  BACKUP_OWNER="root"
  BACKUP_GROUP="root"
fi

DB="${DATABASE_FILE:-/var/lib/momentum/momentum.sqlite}"
KEY="${APP_ENCRYPTION_KEY_FILE:-/var/lib/momentum/.app-encryption-key}"
DOCS="${DOCUMENT_STORAGE_DIR:-/var/lib/momentum/documents}"
SQLITE_MODULE="${MOMENTUM_SQLITE_MODULE:-/opt/momentum/current/server/node_modules/better-sqlite3}"
NODE_BINARY="${MOMENTUM_NODE_BINARY:-/usr/bin/node}"
STAGING_BASE="${BACKUP_STAGING_DIR:-$(dirname "$DB")}"
DEST="${BACKUP_DIR:-/var/backups/momentum}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
if [[ "$TEST_MODE" == 1 && -n "${MOMENTUM_DEPLOY_TEST_BACKUP_STAMP:-}" ]]; then STAMP="$MOMENTUM_DEPLOY_TEST_BACKUP_STAMP"; fi

id "$SERVICE_USER" >/dev/null 2>&1 || { echo "Service user not found: $SERVICE_USER" >&2; exit 1; }
[[ -x "$NODE_BINARY" ]] || { echo "Node executable not found: $NODE_BINARY" >&2; exit 1; }
[[ -s "$DB" && ! -L "$DB" ]] || { echo "SQLite database is missing or is a symbolic link: $DB" >&2; exit 1; }
[[ -s "$KEY" && ! -L "$KEY" ]] || { echo "Connector encryption key is missing or is a symbolic link: $KEY" >&2; exit 1; }
[[ -d "$DOCS" && ! -L "$DOCS" ]] || { echo "Document storage directory is missing or is a symbolic link: $DOCS" >&2; exit 1; }
[[ -d "$SQLITE_MODULE" ]] || { echo "better-sqlite3 runtime is missing: $SQLITE_MODULE" >&2; exit 1; }
if [[ "$TEST_MODE" == 1 ]]; then
  [[ "$(command -v runuser)" == "$TEST_ROOT/bin/runuser" && -x "$TEST_ROOT/bin/runuser" ]] || { echo "Test mode requires an isolated command stub: runuser" >&2; exit 2; }
fi
[[ -d "$STAGING_BASE" && ! -L "$STAGING_BASE" ]] || { echo "SQLite staging directory is missing or is a symbolic link: $STAGING_BASE" >&2; exit 1; }
[[ ! -L "$DEST" ]] || { echo "Backup destination must not be a symbolic link." >&2; exit 1; }
install -d -o "$BACKUP_OWNER" -g "$BACKUP_GROUP" -m 0700 "$DEST"
ARCHIVE="$DEST/momentum-$STAMP.tar.gz"
ARCHIVE_TMP="$ARCHIVE.tmp"
CHECKSUM_TMP="$ARCHIVE.sha256.tmp"
[[ ! -e "$ARCHIVE" && ! -e "$ARCHIVE.sha256" ]] || { echo "A backup with this timestamp already exists; retry in a new second." >&2; exit 1; }
# Stage under the service-owned data filesystem; the root-only backup destination is not traversable by the app user.
STAGE="$(runuser -u "$SERVICE_USER" -- mktemp -d "$STAGING_BASE/.backup-stage-$STAMP.XXXXXX")"
trap 'rm -rf -- "$STAGE"; rm -f -- "$ARCHIVE_TMP" "$CHECKSUM_TMP"' EXIT
install -d -o "$SERVICE_USER" -g "$(id -gn "$SERVICE_USER")" -m 0700 "$STAGE/db"

# The native SQLite backup API includes committed WAL content consistently; do not copy a live .sqlite file directly.
runuser -u "$SERVICE_USER" -- "$NODE_BINARY" - "$DB" "$STAGE/db/momentum.sqlite" "$SQLITE_MODULE" <<'NODE'
const source = process.argv[2];
const destination = process.argv[3];
const modulePath = process.argv[4];
const Database = require(modulePath);
const db = new Database(source, { readonly: true, fileMustExist: true, timeout: 10000 });
db.backup(destination).then(() => { db.close(); }).catch((error) => { console.error('SQLite online backup failed:', error.message); try { db.close(); } catch {} process.exitCode = 1; });
NODE

install -o "$BACKUP_OWNER" -g "$BACKUP_GROUP" -m 0600 "$KEY" "$STAGE/.app-encryption-key"
cp -a "$DOCS" "$STAGE/documents"
chown -R "$BACKUP_OWNER:$BACKUP_GROUP" "$STAGE"
find "$STAGE" -type d -exec chmod 0700 {} +
find "$STAGE" -type f -exec chmod 0600 {} +
tar -C "$STAGE" -czf "$ARCHIVE_TMP" .
chmod 0600 "$ARCHIVE_TMP"
CHECKSUM="$(sha256sum "$ARCHIVE_TMP" | awk '{print $1}')"
printf '%s  %s\n' "$CHECKSUM" "$(basename "$ARCHIVE")" > "$CHECKSUM_TMP"
chmod 0600 "$CHECKSUM_TMP"
mv -f "$ARCHIVE_TMP" "$ARCHIVE"
mv -f "$CHECKSUM_TMP" "$ARCHIVE.sha256"
printf 'SQLite backup created: %s\n' "$ARCHIVE"
printf 'Includes database, connector encryption key and document attachments. Store this archive encrypted/off-host and restrict access.\n'
