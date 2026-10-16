#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="${1:-/opt/momentum}"
TEST_MODE="${MOMENTUM_DEPLOY_TEST_MODE:-0}"
HEALTH_ATTEMPTS=20
HEALTH_INTERVAL=2
TEST_ROOT=""
if [[ "$TEST_MODE" == 1 ]]; then
  TEST_ROOT="${MOMENTUM_DEPLOY_TEST_ROOT:-}"
  if [[ ! "$TEST_ROOT" =~ ^/tmp/momentum-deploy-drill\.[A-Za-z0-9]{6}$ || ! -d "$TEST_ROOT" || -L "$TEST_ROOT" ]]; then
    echo "Test mode requires a private /tmp/momentum-deploy-drill.XXXXXX directory." >&2; exit 2
  fi
  [[ "$(cd -- "$TEST_ROOT" && pwd -P)" == "$TEST_ROOT" && "$(stat -c '%u:%a' "$TEST_ROOT")" == "$(id -u):700" ]] || { echo "Unsafe isolated test root." >&2; exit 2; }
  [[ "$ROOT" == "$TEST_ROOT/opt/momentum" ]] || { echo "Test rollback root must stay inside its isolated test directory." >&2; exit 2; }
  HEALTH_ATTEMPTS=1
  HEALTH_INTERVAL=0
else
  [[ ${EUID:-$(id -u)} -eq 0 ]] || { echo "This rollback step must run as root (use sudo)." >&2; exit 1; }
  [[ "$ROOT" == /opt/momentum ]] || { echo "Invalid deployment root; this deployment is fixed at /opt/momentum." >&2; exit 2; }
fi
for command_name in systemctl curl readlink realpath; do command -v "$command_name" >/dev/null 2>&1 || { echo "Required remote command missing: $command_name" >&2; exit 1; }; done
[[ "$(realpath -m -- "$ROOT")" == "$ROOT" ]] || { echo "Deployment root or one of its parents is not canonical." >&2; exit 1; }
if [[ "$TEST_MODE" == 1 ]]; then
  for command_name in systemctl curl; do
    [[ "$(command -v "$command_name")" == "$TEST_ROOT/bin/$command_name" && -x "$TEST_ROOT/bin/$command_name" ]] || { echo "Test mode requires an isolated command stub: $command_name" >&2; exit 2; }
  done
fi

resolve_release_link() {
  local name="$1" path="$ROOT/$1" resolved
  if [[ ! -e "$path" && ! -L "$path" ]]; then return 0; fi
  [[ -L "$path" ]] || { echo "Managed release pointer is not a symbolic link: $path" >&2; return 1; }
  resolved="$(readlink -f -- "$path" 2>/dev/null || true)"
  [[ -n "$resolved" && -d "$resolved" && "$resolved" == "$ROOT/releases/"* ]] || { echo "Managed release pointer escapes releases/: $path" >&2; return 1; }
  printf '%s' "$resolved"
}
CURRENT="$(resolve_release_link current)" || exit 1
PREVIOUS="$(resolve_release_link previous)" || exit 1
if [[ -z "$CURRENT" ]]; then echo "No current release is installed." >&2; exit 1; fi
if [[ -z "$PREVIOUS" ]]; then echo "No previous release is available." >&2; exit 1; fi
ln -s "$PREVIOUS" "$ROOT/.rollback-manual"
mv -Tf "$ROOT/.rollback-manual" "$ROOT/current"
ln -s "$CURRENT" "$ROOT/.previous-manual"
mv -Tf "$ROOT/.previous-manual" "$ROOT/previous"
RESTART_OK=true
if ! systemctl restart momentum.service; then
  RESTART_OK=false
  echo "Could not restart momentum.service on the rollback target." >&2
fi
health_check() {
  for attempt in $(seq 1 "$HEALTH_ATTEMPTS"); do
    if curl --silent --fail --max-time 3 http://127.0.0.1:4000/api/health >/dev/null; then return 0; fi
    sleep "$HEALTH_INTERVAL"
  done
  return 1
}
if [[ "$RESTART_OK" == true ]] && health_check; then printf 'Rollback healthy: %s\n' "$PREVIOUS"; exit 0; fi
# The rollback itself did not pass: restore the release that was active before this command.
ln -s "$CURRENT" "$ROOT/.restore-manual"
mv -Tf "$ROOT/.restore-manual" "$ROOT/current"
ln -s "$PREVIOUS" "$ROOT/.previous-restore"
mv -Tf "$ROOT/.previous-restore" "$ROOT/previous"
systemctl restart momentum.service || true
echo "Rollback health check failed; restored prior active symlink. Inspect journalctl -u momentum.service." >&2
exit 1
