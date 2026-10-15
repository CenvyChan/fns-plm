#!/usr/bin/env bash
set -Eeuo pipefail

RELEASE="${1:-}"
ARCHIVE="${2:-}"
ROOT="${3:-/opt/momentum}"
if [[ ${EUID:-$(id -u)} -ne 0 ]]; then echo "This remote release step must run as root (use sudo)." >&2; exit 1; fi
if [[ ! "$RELEASE" =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; then echo "Invalid release id." >&2; exit 2; fi
if [[ ! "$ARCHIVE" =~ ^/tmp/momentum-[0-9]{8}T[0-9]{6}Z\.tar\.gz$ ]]; then echo "Invalid staged archive path." >&2; exit 2; fi
if [[ "$ROOT" == / || ! "$ROOT" =~ ^/[A-Za-z0-9._/-]+$ || "$ROOT" == *"/../"* || "$ROOT" == */.. || "$ROOT" == *"/./"* || "$ROOT" == */. ]]; then echo "Invalid deployment root." >&2; exit 2; fi
for command_name in tar npm node systemctl curl runuser grep; do command -v "$command_name" >/dev/null 2>&1 || { echo "Required remote command missing: $command_name" >&2; exit 1; }; done
id momentum >/dev/null 2>&1 || { echo "Service user momentum is missing; run bootstrap.sh first." >&2; exit 1; }
[[ -f /etc/momentum/momentum.env ]] || { echo "Missing /etc/momentum/momentum.env; run bootstrap.sh first." >&2; exit 1; }
[[ -f "$ARCHIVE" ]] || { echo "Staged archive not found: $ARCHIVE" >&2; exit 1; }

RELEASE_DIR="$ROOT/releases/$RELEASE"
install -d -o root -g root -m 0755 "$ROOT" "$ROOT/releases" "$ROOT/incoming"
[[ ! -e "$RELEASE_DIR" ]] || { echo "Release already exists: $RELEASE_DIR" >&2; exit 1; }
if tar -tzf "$ARCHIVE" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then echo "Unsafe path found in release archive." >&2; exit 1; fi
install -d -o momentum -g momentum -m 0755 "$RELEASE_DIR"
tar --no-same-owner --no-same-permissions -xzf "$ARCHIVE" -C "$RELEASE_DIR"
for required in client/dist/index.html server/dist/index.js server/workflow/processes/plm-approvals.bpmn20.xml server/package.json server/package-lock.json server/data/seed-workspace.json server/data/seed-workflow-demo.json deploy/ubuntu/backup-sqlite.sh; do
  [[ -f "$RELEASE_DIR/$required" ]] || { echo "Release is incomplete: $required" >&2; exit 1; }
done
chown -R momentum:momentum "$RELEASE_DIR"
runuser -u momentum -- env HOME=/var/lib/momentum npm --prefix "$RELEASE_DIR/server" ci --omit=dev --no-audit --no-fund
runuser -u momentum -- node --check "$RELEASE_DIR/server/dist/index.js"

PREVIOUS=""
if [[ -L "$ROOT/current" ]]; then PREVIOUS="$(readlink -f "$ROOT/current" || true)"; fi
OLD_PREVIOUS="$(readlink -f "$ROOT/previous" 2>/dev/null || true)"
if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
  ln -s "$PREVIOUS" "$ROOT/.previous-$RELEASE"
  mv -Tf "$ROOT/.previous-$RELEASE" "$ROOT/previous"
fi
ln -s "$RELEASE_DIR" "$ROOT/.current-$RELEASE"
mv -Tf "$ROOT/.current-$RELEASE" "$ROOT/current"

health_check() {
  for attempt in $(seq 1 20); do
    if curl --silent --fail --max-time 3 http://127.0.0.1:4000/api/health >/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}

systemctl restart momentum.service
if ! health_check; then
  echo "New release failed its API health check; rolling back." >&2
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
    ln -s "$PREVIOUS" "$ROOT/.rollback-$RELEASE"
    mv -Tf "$ROOT/.rollback-$RELEASE" "$ROOT/current"
    if [[ -n "$OLD_PREVIOUS" && -d "$OLD_PREVIOUS" && "$OLD_PREVIOUS" != "$PREVIOUS" ]]; then
      ln -s "$OLD_PREVIOUS" "$ROOT/.previous-rollback-$RELEASE"
      mv -Tf "$ROOT/.previous-rollback-$RELEASE" "$ROOT/previous"
    else
      rm -f "$ROOT/previous"
    fi
    systemctl restart momentum.service || true
    if health_check; then echo "Rollback healthy: $PREVIOUS" >&2; else echo "Rollback target also failed health check; inspect journalctl -u momentum.service." >&2; fi
  else
    rm -f "$ROOT/current"
    systemctl stop momentum.service || true
    echo "No previous release exists; service was stopped." >&2
  fi
  exit 1
fi
rm -f "$ARCHIVE"

# Keep recent releases and always preserve the active and previous targets.
ACTIVE="$(readlink -f "$ROOT/current" || true)"
PREV_LINK="$(readlink -f "$ROOT/previous" 2>/dev/null || true)"
mapfile -t RELEASES < <(find "$ROOT/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | cut -d' ' -f2-)
for ((i=5; i<${#RELEASES[@]}; i++)); do
  candidate="${RELEASES[$i]}"
  [[ "$candidate" == "$ACTIVE" || "$candidate" == "$PREV_LINK" ]] || rm -rf -- "$candidate"
done
printf 'Release active: %s\n' "$RELEASE_DIR"
printf 'Health check: http://127.0.0.1:4000/api/health OK\n'
