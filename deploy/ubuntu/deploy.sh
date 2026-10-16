#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
TARGET="${1:-}"
SSH_PORT="${2:-22}"
REMOTE_ROOT="/opt/momentum"
DRY_RUN=false
if [[ "$TARGET" == --dry-run ]]; then DRY_RUN=true; TARGET=""; fi

if [[ -z "$TARGET" && "$DRY_RUN" != true ]]; then
  echo "Usage: $0 <ssh-user@ubuntu-host> [ssh-port]" >&2
  echo "       $0 --dry-run  (build and inspect the release bundle without SSH)" >&2
  exit 2
fi
if [[ "$DRY_RUN" != true ]]; then
  if [[ "$TARGET" == -* || ! "$TARGET" =~ ^[A-Za-z0-9._@:-]+$ ]]; then echo "SSH target contains unsupported characters." >&2; exit 2; fi
  if [[ ! "$SSH_PORT" =~ ^[0-9]{1,5}$ ]] || (( SSH_PORT < 1 || SSH_PORT > 65535 )); then echo "Invalid SSH port." >&2; exit 2; fi
  if [[ "$REMOTE_ROOT" != /opt/momentum ]]; then echo "Remote root must be /opt/momentum." >&2; exit 2; fi
fi
for tool in npm tar sha256sum; do command -v "$tool" >/dev/null 2>&1 || { echo "Required local command missing: $tool" >&2; exit 1; }; done
if [[ "$DRY_RUN" != true ]]; then for tool in ssh scp; do command -v "$tool" >/dev/null 2>&1 || { echo "Required local command missing: $tool" >&2; exit 1; }; done; fi

RELEASE="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
BUNDLE="$WORK/bundle"
ARCHIVE="$WORK/momentum-$RELEASE.tar.gz"
REMOTE_ARCHIVE="/tmp/momentum-$RELEASE.tar.gz"

printf 'Building frontend and API for release %s...\n' "$RELEASE"
npm run build --prefix "$ROOT/client"
npm run build --prefix "$ROOT/server"
mkdir -p "$BUNDLE/client" "$BUNDLE/server/data" "$BUNDLE/deploy/ubuntu"
cp -a "$ROOT/client/dist" "$BUNDLE/client/dist"
cp -a "$ROOT/server/dist" "$BUNDLE/server/dist"
cp -a "$ROOT/server/workflow" "$BUNDLE/server/"
cp "$ROOT/server/package.json" "$ROOT/server/package-lock.json" "$BUNDLE/server/"
cp "$ROOT/server/data/seed-workspace.json" "$ROOT/server/data/seed-workflow-demo.json" "$BUNDLE/server/data/"
install -m 0755 "$SCRIPT_DIR/backup-sqlite.sh" "$BUNDLE/deploy/ubuntu/backup-sqlite.sh"
# Selective staging deliberately excludes .env, node_modules, live JSON data, uploads and credentials.
tar -C "$BUNDLE" -czf "$ARCHIVE" client server deploy
if [[ "$DRY_RUN" == true ]]; then
  echo "Dry-run release contents:"
  tar -tzf "$ARCHIVE"
  if tar -tzf "$ARCHIVE" | grep -E '(^|/)(\.env|node_modules|workspace\.json|workflow-demo\.json|workflow-audit\.json|report-schedules\.json)$' >/dev/null; then
    echo "Unexpected secret, dependency, or live-data file found in release bundle." >&2
    exit 1
  fi
  echo "Dry run passed: no SSH connection was made; live data and environment files are excluded."
  exit 0
fi

ARCHIVE_SHA256="$(sha256sum -- "$ARCHIVE")"
ARCHIVE_SHA256="${ARCHIVE_SHA256%% *}"
[[ "$ARCHIVE_SHA256" =~ ^[a-fA-F0-9]{64}$ ]] || { echo "Could not calculate release archive SHA-256." >&2; exit 1; }
printf 'Checking SSH and non-interactive sudo access for %s...\n' "$TARGET"
ssh -p "$SSH_PORT" "$TARGET" 'sudo -n true'
printf 'Uploading release bundle...\n'
scp -P "$SSH_PORT" "$ARCHIVE" "$TARGET:$REMOTE_ARCHIVE"
printf 'Activating release with archive checksum verification and health-check rollback...\n'
ssh -p "$SSH_PORT" "$TARGET" "sudo -n bash -s -- '$RELEASE' '$REMOTE_ARCHIVE' '$REMOTE_ROOT' '$ARCHIVE_SHA256'" < "$SCRIPT_DIR/release-remote.sh"
