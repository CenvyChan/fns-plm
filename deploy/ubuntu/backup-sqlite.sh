#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then echo "Run with sudo: sudo bash deploy/ubuntu/backup-sqlite.sh" >&2; exit 1; fi
DB="${DATABASE_FILE:-/var/lib/momentum/momentum.sqlite}"
KEY="${APP_ENCRYPTION_KEY_FILE:-/var/lib/momentum/.app-encryption-key}"
DOCS="${DOCUMENT_STORAGE_DIR:-/var/lib/momentum/documents}"
SQLITE_MODULE="${MOMENTUM_SQLITE_MODULE:-/opt/momentum/current/server/node_modules/better-sqlite3}"
NODE_BINARY="${MOMENTUM_NODE_BINARY:-/usr/bin/node}"
SERVICE_USER="${MOMENTUM_SERVICE_USER:-momentum}"
STAGING_BASE="${BACKUP_STAGING_DIR:-$(dirname "$DB")}"
DEST="${BACKUP_DIR:-/var/backups/momentum}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
id "$SERVICE_USER" >/dev/null 2>&1 || { echo "Service user not found: $SERVICE_USER" >&2; exit 1; }
[[ -x "$NODE_BINARY" ]] || { echo "Node executable not found: $NODE_BINARY" >&2; exit 1; }
[[ -s "$DB" ]] || { echo "SQLite database is missing: $DB" >&2; exit 1; }
[[ -s "$KEY" ]] || { echo "Connector encryption key is missing: $KEY" >&2; exit 1; }
[[ -d "$DOCS" ]] || { echo "Document storage directory is missing: $DOCS" >&2; exit 1; }
[[ -d "$SQLITE_MODULE" ]] || { echo "better-sqlite3 runtime is missing: $SQLITE_MODULE" >&2; exit 1; }
[[ -d "$STAGING_BASE" ]] || { echo "SQLite staging directory is missing: $STAGING_BASE" >&2; exit 1; }
install -d -o root -g root -m 0700 "$DEST"
ARCHIVE="$DEST/momentum-$STAMP.tar.gz"
ARCHIVE_TMP="$ARCHIVE.tmp"
CHECKSUM_TMP="$ARCHIVE.sha256.tmp"
[[ ! -e "$ARCHIVE" ]] || { echo "A backup with this timestamp already exists; retry in a new second." >&2; exit 1; }
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

install -o root -g root -m 0600 "$KEY" "$STAGE/.app-encryption-key"
cp -a "$DOCS" "$STAGE/documents"
chown -R root:root "$STAGE"
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
