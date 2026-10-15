#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
TARGET="${1:-}"
SSH_PORT="${2:-22}"
DRY_RUN=false
if [[ "$TARGET" == --dry-run ]]; then DRY_RUN=true; TARGET=""; fi
if [[ "$DRY_RUN" != true && -z "$TARGET" ]]; then echo "Usage: $0 <ssh-user@ubuntu-host> [ssh-port]" >&2; echo "       $0 --dry-run" >&2; exit 2; fi
if [[ "$DRY_RUN" != true ]]; then
  [[ "$TARGET" != -* && "$TARGET" =~ ^[A-Za-z0-9._@:-]+$ ]] || { echo "SSH target contains unsupported characters." >&2; exit 2; }
  [[ "$SSH_PORT" =~ ^[0-9]{1,5}$ ]] && (( SSH_PORT >= 1 && SSH_PORT <= 65535 )) || { echo "Invalid SSH port." >&2; exit 2; }
fi
for tool in mvn tar grep; do command -v "$tool" >/dev/null 2>&1 || { echo "Required local command missing: $tool" >&2; exit 1; }; done
if [[ "$DRY_RUN" != true ]]; then for tool in ssh scp; do command -v "$tool" >/dev/null 2>&1 || { echo "Required local command missing: $tool" >&2; exit 1; }; done; fi

RELEASE="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
BUNDLE="$WORK/bundle"
ARCHIVE="$WORK/momentum-flowable-$RELEASE.tar.gz"
REMOTE_ARCHIVE="/tmp/momentum-flowable-$RELEASE.tar.gz"

printf 'Building standalone Flowable service for release %s...\n' "$RELEASE"
mvn -f "$ROOT/flowable-service/pom.xml" -DskipTests package
JAR="$ROOT/flowable-service/target/momentum-flowable-service.jar"
[[ -s "$JAR" ]] || { echo "Flowable executable JAR was not produced." >&2; exit 1; }
mkdir -p "$BUNDLE"
install -m 0644 "$JAR" "$BUNDLE/momentum-flowable-service.jar"
# Only the executable JAR is staged. Source .env, H2 files, credentials and other targets are excluded.
tar -C "$BUNDLE" -czf "$ARCHIVE" momentum-flowable-service.jar
if [[ "$DRY_RUN" == true ]]; then
  echo "Dry-run Flowable release contents:"; tar -tzf "$ARCHIVE"
  if tar -tzf "$ARCHIVE" | grep -Eq '(^|/)\.env$|\.mv\.db$|\.trace\.db$'; then echo "Unexpected environment or database file found." >&2; exit 1; fi
  echo "Dry run passed: no SSH connection was made; runtime credentials and engine database are excluded."
  exit 0
fi

printf 'Checking SSH and non-interactive sudo access for %s...\n' "$TARGET"
ssh -p "$SSH_PORT" "$TARGET" 'sudo -n true'
printf 'Uploading Flowable release bundle...\n'
scp -P "$SSH_PORT" "$ARCHIVE" "$TARGET:$REMOTE_ARCHIVE"
printf 'Activating the standalone Flowable service with local health-check rollback...\n'
ssh -p "$SSH_PORT" "$TARGET" "sudo -n bash -s -- '$RELEASE' '$REMOTE_ARCHIVE' '/opt/momentum-flowable'" < "$SCRIPT_DIR/release-flowable-remote.sh"
