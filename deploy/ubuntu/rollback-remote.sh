#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="${1:-/opt/momentum}"
if [[ ${EUID:-$(id -u)} -ne 0 ]]; then echo "This rollback step must run as root (use sudo)." >&2; exit 1; fi
if [[ "$ROOT" == / || ! "$ROOT" =~ ^/[A-Za-z0-9._/-]+$ || "$ROOT" == *"/../"* || "$ROOT" == */.. || "$ROOT" == *"/./"* || "$ROOT" == */. ]]; then echo "Invalid deployment root." >&2; exit 2; fi
CURRENT="$(readlink -f "$ROOT/current" 2>/dev/null || true)"
PREVIOUS="$(readlink -f "$ROOT/previous" 2>/dev/null || true)"
if [[ -z "$CURRENT" || ! -d "$CURRENT" ]]; then echo "No current release is installed." >&2; exit 1; fi
if [[ -z "$PREVIOUS" || ! -d "$PREVIOUS" ]]; then echo "No previous release is available." >&2; exit 1; fi
ln -s "$PREVIOUS" "$ROOT/.rollback-manual"
mv -Tf "$ROOT/.rollback-manual" "$ROOT/current"
ln -s "$CURRENT" "$ROOT/.previous-manual"
mv -Tf "$ROOT/.previous-manual" "$ROOT/previous"
systemctl restart momentum.service
health_check() {
  for attempt in $(seq 1 20); do
    if curl --silent --fail --max-time 3 http://127.0.0.1:4000/api/health >/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}
if health_check; then printf 'Rollback healthy: %s\n' "$PREVIOUS"; exit 0; fi
# The rollback itself did not pass: restore the release that was active before this command.
ln -s "$CURRENT" "$ROOT/.restore-manual"
mv -Tf "$ROOT/.restore-manual" "$ROOT/current"
ln -s "$PREVIOUS" "$ROOT/.previous-restore"
mv -Tf "$ROOT/.previous-restore" "$ROOT/previous"
systemctl restart momentum.service || true
echo "Rollback health check failed; restored prior active symlink. Inspect journalctl -u momentum.service." >&2
exit 1
