#!/usr/bin/env bash
set -Eeuo pipefail

RELEASE="${1:-}"
ARCHIVE="${2:-}"
ROOT="${3:-/opt/momentum-flowable}"
if [[ ${EUID:-$(id -u)} -ne 0 ]]; then echo "This remote Flowable release step must run as root (use sudo)." >&2; exit 1; fi
if [[ ! "$RELEASE" =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; then echo "Invalid release id." >&2; exit 2; fi
if [[ ! "$ARCHIVE" =~ ^/tmp/momentum-flowable-[0-9]{8}T[0-9]{6}Z\.tar\.gz$ ]]; then echo "Invalid staged archive path." >&2; exit 2; fi
if [[ "$ROOT" == / || ! "$ROOT" =~ ^/[A-Za-z0-9._/-]+$ || "$ROOT" == *"/../"* || "$ROOT" == */.. || "$ROOT" == *"/./"* || "$ROOT" == */. ]]; then echo "Invalid Flowable deployment root." >&2; exit 2; fi
for command_name in tar systemctl curl runuser grep; do command -v "$command_name" >/dev/null 2>&1 || { echo "Required remote command missing: $command_name" >&2; exit 1; }; done
[[ -x /usr/bin/java ]] || { echo "Java 21+ is required at /usr/bin/java." >&2; exit 1; }
/usr/bin/java -version 2>&1 | head -n 1 | grep -q 'version "21\|version "22\|version "23\|version "24\|version "25' || { echo "Java 21+ is required." >&2; exit 1; }
id momentum-flowable >/dev/null 2>&1 || { echo "Service user momentum-flowable is missing; run bootstrap.sh first." >&2; exit 1; }
[[ -f /etc/momentum-flowable/momentum-flowable.env ]] || { echo "Missing Flowable environment file; run bootstrap.sh first." >&2; exit 1; }
[[ -f "$ARCHIVE" ]] || { echo "Staged archive not found." >&2; exit 1; }
if tar -tzf "$ARCHIVE" | grep -Eq '(^/|(^|/)\.\.(/|$)|(^|/)\.env$)'; then echo "Unsafe path or environment file found in Flowable release archive." >&2; exit 1; fi

RELEASE_DIR="$ROOT/releases/$RELEASE"
install -d -o root -g root -m 0755 "$ROOT" "$ROOT/releases"
[[ ! -e "$RELEASE_DIR" ]] || { echo "Release already exists." >&2; exit 1; }
install -d -o momentum-flowable -g momentum-flowable -m 0755 "$RELEASE_DIR"
tar --no-same-owner --no-same-permissions -xzf "$ARCHIVE" -C "$RELEASE_DIR"
[[ -s "$RELEASE_DIR/momentum-flowable-service.jar" ]] || { echo "Flowable JAR missing from release." >&2; exit 1; }
chown -R momentum-flowable:momentum-flowable "$RELEASE_DIR"
runuser -u momentum-flowable -- /usr/bin/java -version >/dev/null 2>&1

PREVIOUS="$(readlink -f "$ROOT/current" 2>/dev/null || true)"
OLD_PREVIOUS="$(readlink -f "$ROOT/previous" 2>/dev/null || true)"
if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then ln -s "$PREVIOUS" "$ROOT/.previous-$RELEASE"; mv -Tf "$ROOT/.previous-$RELEASE" "$ROOT/previous"; fi
ln -s "$RELEASE_DIR" "$ROOT/.current-$RELEASE"
mv -Tf "$ROOT/.current-$RELEASE" "$ROOT/current"

port="$(awk -F= '$1=="FLOWABLE_PORT" {gsub(/[[:space:]]/,"",$2); print $2; exit}' /etc/momentum-flowable/momentum-flowable.env)"
port="${port:-8090}"
[[ "$port" =~ ^[0-9]{1,5}$ ]] && (( port >= 1 && port <= 65535 )) || { echo "Invalid FLOWABLE_PORT in environment file." >&2; exit 2; }
health_check() {
  for attempt in $(seq 1 30); do
    if curl --silent --fail --max-time 3 "http://127.0.0.1:$port/flowable-rest/actuator/health" >/dev/null; then return 0; fi
    sleep 2
  done
  return 1
}
systemctl daemon-reload
systemctl enable momentum-flowable.service
systemctl restart momentum-flowable.service
if ! health_check; then
  echo "New Flowable release failed its local health check; restoring previous release." >&2
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
    ln -s "$PREVIOUS" "$ROOT/.rollback-$RELEASE"; mv -Tf "$ROOT/.rollback-$RELEASE" "$ROOT/current"
    if [[ -n "$OLD_PREVIOUS" && -d "$OLD_PREVIOUS" && "$OLD_PREVIOUS" != "$PREVIOUS" ]]; then ln -s "$OLD_PREVIOUS" "$ROOT/.previous-rollback-$RELEASE"; mv -Tf "$ROOT/.previous-rollback-$RELEASE" "$ROOT/previous"; else rm -f "$ROOT/previous"; fi
    systemctl restart momentum-flowable.service || true
  else
    rm -f "$ROOT/current"; systemctl stop momentum-flowable.service || true
  fi
  exit 1
fi
rm -f "$ARCHIVE"
printf 'Flowable release active: %s\n' "$RELEASE_DIR"
printf 'Health check: http://127.0.0.1:%s/flowable-rest/actuator/health OK\n' "$port"
