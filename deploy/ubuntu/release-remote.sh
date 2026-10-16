#!/usr/bin/env bash
set -Eeuo pipefail

RELEASE="${1:-}"
ARCHIVE="${2:-}"
ROOT="${3:-/opt/momentum}"
EXPECTED_SHA256="${4:-}"
TEST_MODE="${MOMENTUM_DEPLOY_TEST_MODE:-0}"
HEALTH_ATTEMPTS=20
HEALTH_INTERVAL=2
SERVICE_USER="momentum"
SERVICE_HOME="/var/lib/momentum"
ENV_FILE="/etc/momentum/momentum.env"
ROOT_OWNER="root"
ROOT_GROUP="root"
TEST_ROOT=""

if [[ "$TEST_MODE" == 1 ]]; then
  TEST_ROOT="${MOMENTUM_DEPLOY_TEST_ROOT:-}"
  if [[ ! "$TEST_ROOT" =~ ^/tmp/momentum-deploy-drill\.[A-Za-z0-9]{6}$ || ! -d "$TEST_ROOT" || -L "$TEST_ROOT" ]]; then
    echo "Test mode requires a private /tmp/momentum-deploy-drill.XXXXXX directory." >&2; exit 2
  fi
  [[ "$(cd -- "$TEST_ROOT" && pwd -P)" == "$TEST_ROOT" && "$(stat -c '%u:%a' "$TEST_ROOT")" == "$(id -u):700" ]] || { echo "Unsafe isolated test root." >&2; exit 2; }
  [[ "$ROOT" == "$TEST_ROOT/opt/momentum" ]] || { echo "Test deployment root must stay inside its isolated test directory." >&2; exit 2; }
  [[ "$ARCHIVE" == "$TEST_ROOT/staging/momentum-$RELEASE.tar.gz" ]] || { echo "Test archive must stay inside the isolated staging directory." >&2; exit 2; }
  SERVICE_USER="$(id -un)"
  SERVICE_HOME="$TEST_ROOT/home"
  ENV_FILE="$TEST_ROOT/etc/momentum.env"
  ROOT_OWNER="$(id -un)"
  ROOT_GROUP="$(id -gn)"
  HEALTH_ATTEMPTS=1
  HEALTH_INTERVAL=0
else
  [[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "This remote release step must run as root (use sudo)." >&2; exit 1; }
  [[ "$ROOT" == /opt/momentum ]] || { echo "Invalid deployment root; this deployment is fixed at /opt/momentum." >&2; exit 2; }
fi

if [[ ! "$RELEASE" =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; then echo "Invalid release id." >&2; exit 2; fi
if [[ "$TEST_MODE" != 1 && "$ARCHIVE" != "/tmp/momentum-$RELEASE.tar.gz" ]]; then echo "Invalid staged archive path." >&2; exit 2; fi
if [[ ! "$EXPECTED_SHA256" =~ ^[a-fA-F0-9]{64}$ ]]; then echo "A valid expected SHA-256 checksum is required." >&2; exit 2; fi
for command_name in tar npm node systemctl curl runuser grep sha256sum awk realpath; do command -v "$command_name" >/dev/null 2>&1 || { echo "Required remote command missing: $command_name" >&2; exit 1; }; done
if [[ "$TEST_MODE" == 1 ]]; then
  for command_name in npm systemctl curl runuser; do
    [[ "$(command -v "$command_name")" == "$TEST_ROOT/bin/$command_name" && -x "$TEST_ROOT/bin/$command_name" ]] || { echo "Test mode requires an isolated command stub: $command_name" >&2; exit 2; }
  done
fi
id "$SERVICE_USER" >/dev/null 2>&1 || { echo "Service user is missing: $SERVICE_USER" >&2; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "Missing service environment file: $ENV_FILE" >&2; exit 1; }
[[ -f "$ARCHIVE" && ! -L "$ARCHIVE" ]] || { echo "Staged release archive is missing or is a symbolic link." >&2; exit 1; }

ACTUAL_SHA256="$(sha256sum -- "$ARCHIVE")"
ACTUAL_SHA256="${ACTUAL_SHA256%% *}"
if [[ "${ACTUAL_SHA256,,}" != "${EXPECTED_SHA256,,}" ]]; then
  echo "Release archive SHA-256 mismatch; refusing to publish." >&2
  exit 1
fi
if ! tar -tzf "$ARCHIVE" >/dev/null; then echo "Release archive is empty or unreadable." >&2; exit 1; fi
if tar -tzf "$ARCHIVE" | grep -E '(^/|(^|/)\.\.(/|$))' >/dev/null; then echo "Unsafe path found in release archive." >&2; exit 1; fi
if ! tar -tvzf "$ARCHIVE" | awk 'substr($0,1,1) != "-" && substr($0,1,1) != "d" { bad=1 } END { exit bad ? 1 : 0 }'; then
  echo "Release archive contains a link or special file; refusing to extract it." >&2; exit 1
fi

[[ "$(realpath -m -- "$ROOT")" == "$ROOT" ]] || { echo "Deployment root or one of its parents is not canonical." >&2; exit 1; }
for managed_dir in "$ROOT/releases" "$ROOT/incoming"; do
  [[ ! -L "$managed_dir" ]] || { echo "Managed deployment directory must not be a symbolic link: $managed_dir" >&2; exit 1; }
done
RELEASE_DIR="$ROOT/releases/$RELEASE"
PREVIOUS=""
OLD_PREVIOUS=""
RELEASE_CREATED=false
ACTIVATED=false
cleanup_release() {
  if [[ "$RELEASE_CREATED" == true && "$ACTIVATED" != true && -n "$RELEASE_DIR" && "$RELEASE_DIR" == "$ROOT/releases/"* && -d "$RELEASE_DIR" ]]; then
    rm -rf -- "$RELEASE_DIR"
  fi
}
trap cleanup_release EXIT

install -d -o "$ROOT_OWNER" -g "$ROOT_GROUP" -m 0755 "$ROOT" "$ROOT/releases" "$ROOT/incoming"
[[ ! -e "$RELEASE_DIR" && ! -L "$RELEASE_DIR" ]] || { echo "Release already exists: $RELEASE_DIR" >&2; exit 1; }

resolve_release_link() {
  local name="$1" path="$ROOT/$1" resolved
  if [[ ! -e "$path" && ! -L "$path" ]]; then return 0; fi
  [[ -L "$path" ]] || { echo "Managed release pointer is not a symbolic link: $path" >&2; return 1; }
  resolved="$(readlink -f -- "$path" 2>/dev/null || true)"
  [[ -n "$resolved" && -d "$resolved" && "$resolved" == "$ROOT/releases/"* ]] || { echo "Managed release pointer escapes releases/: $path" >&2; return 1; }
  printf '%s' "$resolved"
}
PREVIOUS="$(resolve_release_link current)" || exit 1
OLD_PREVIOUS="$(resolve_release_link previous)" || exit 1

mkdir -m 0755 -- "$RELEASE_DIR"
RELEASE_CREATED=true
chown "$SERVICE_USER:$(id -gn "$SERVICE_USER")" "$RELEASE_DIR"
tar --no-same-owner --no-same-permissions -xzf "$ARCHIVE" -C "$RELEASE_DIR"
for required in client/dist/index.html server/dist/index.js server/workflow/processes/plm-approvals.bpmn20.xml server/package.json server/package-lock.json server/data/seed-workspace.json server/data/seed-workflow-demo.json deploy/ubuntu/backup-sqlite.sh; do
  [[ -f "$RELEASE_DIR/$required" ]] || { echo "Release is incomplete: $required" >&2; exit 1; }
done
chown -R "$SERVICE_USER:$(id -gn "$SERVICE_USER")" "$RELEASE_DIR"
if [[ "$TEST_MODE" == 1 ]]; then install -d -o "$SERVICE_USER" -g "$(id -gn "$SERVICE_USER")" -m 0700 "$SERVICE_HOME"; fi
runuser -u "$SERVICE_USER" -- env HOME="$SERVICE_HOME" npm --prefix "$RELEASE_DIR/server" ci --omit=dev --no-audit --no-fund
runuser -u "$SERVICE_USER" -- node --check "$RELEASE_DIR/server/dist/index.js"

if [[ -n "$PREVIOUS" ]]; then
  ln -s "$PREVIOUS" "$ROOT/.previous-$RELEASE"
  mv -Tf "$ROOT/.previous-$RELEASE" "$ROOT/previous"
fi
ln -s "$RELEASE_DIR" "$ROOT/.current-$RELEASE"
mv -Tf "$ROOT/.current-$RELEASE" "$ROOT/current"
ACTIVATED=true

health_check() {
  for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if curl --silent --fail --max-time 3 http://127.0.0.1:4000/api/health >/dev/null; then return 0; fi
    sleep "$HEALTH_INTERVAL"
  done
  return 1
}

RESTART_OK=true
if ! systemctl restart momentum.service; then
  RESTART_OK=false
  echo "Could not restart momentum.service with the new release; rolling back." >&2
fi
if [[ "$RESTART_OK" != true ]] || ! health_check; then
  echo "New release failed its API health check; rolling back." >&2
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
    ln -s "$PREVIOUS" "$ROOT/.rollback-$RELEASE"
    mv -Tf "$ROOT/.rollback-$RELEASE" "$ROOT/current"
    if [[ -n "$OLD_PREVIOUS" && -d "$OLD_PREVIOUS" && "$OLD_PREVIOUS" != "$PREVIOUS" ]]; then
      ln -s "$OLD_PREVIOUS" "$ROOT/.previous-rollback-$RELEASE"
      mv -Tf "$ROOT/.previous-rollback-$RELEASE" "$ROOT/previous"
    else
      rm -f -- "$ROOT/previous"
    fi
    systemctl restart momentum.service || true
    if health_check; then echo "Rollback healthy: $PREVIOUS" >&2; else echo "Rollback target also failed health check; inspect journalctl -u momentum.service." >&2; fi
  else
    rm -f -- "$ROOT/current"
    systemctl stop momentum.service || true
    echo "No previous release exists; service was stopped." >&2
  fi
  exit 1
fi
rm -f -- "$ARCHIVE"

# Keep recent releases and always preserve the active and previous targets.
ACTIVE="$(readlink -f -- "$ROOT/current" || true)"
PREV_LINK="$(readlink -f -- "$ROOT/previous" 2>/dev/null || true)"
mapfile -t RELEASES < <(find "$ROOT/releases" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | cut -d' ' -f2-)
for ((i=5; i<${#RELEASES[@]}; i++)); do
  candidate="${RELEASES[$i]}"
  [[ "$candidate" == "$ACTIVE" || "$candidate" == "$PREV_LINK" ]] || rm -rf -- "$candidate"
done
printf 'Release active: %s\n' "$RELEASE_DIR"
printf 'Health check: http://127.0.0.1:4000/api/health OK\n'
