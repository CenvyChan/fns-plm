#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID:-$(id -u)} -ne 0 ]]; then
  echo "Run with sudo: sudo bash deploy/ubuntu/bootstrap.sh" >&2
  exit 1
fi
if [[ ! -r /etc/os-release ]]; then echo "Cannot identify Linux distribution." >&2; exit 1; fi
. /etc/os-release
if [[ ${ID:-} != ubuntu ]]; then echo "This bootstrap targets Ubuntu; detected ${ID:-unknown}." >&2; exit 1; fi
if [[ ! -x /usr/bin/node || ! -x /usr/bin/npm ]]; then
  echo "Install system-wide Node.js 20+ and npm at /usr/bin/node and /usr/bin/npm before bootstrap; user-local NVM installs are not visible to systemd." >&2
  exit 1
fi
/usr/bin/node -e 'const major=Number(process.versions.node.split(".")[0]); if(major<20){console.error("Node.js 20+ is required; found "+process.versions.node);process.exit(1)}'
if [[ -x /usr/bin/java ]]; then
  /usr/bin/java -version 2>&1 | head -n 1 | grep -Eq 'version "(2[1-9]|[3-9][0-9])\.' || { echo "The included standalone Flowable service requires Java 21+ at /usr/bin/java." >&2; exit 1; }
else
  echo "Java 21+ is not installed; Node/SQLite will be prepared, but deploy-flowable.sh requires Java 21+ on both build and target hosts."
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if ! getent group momentum >/dev/null 2>&1; then groupadd --system momentum; fi
if ! id momentum >/dev/null 2>&1; then useradd --system --gid momentum --home-dir /var/lib/momentum --create-home --shell /usr/sbin/nologin momentum; fi
install -d -o root -g root -m 0755 /opt/momentum /opt/momentum/releases /opt/momentum/incoming
install -d -o momentum -g momentum -m 0750 /var/lib/momentum
install -d -o root -g root -m 0750 /etc/momentum
install -d -o momentum -g momentum -m 0750 /var/lib/momentum/documents
if [[ ! -e /etc/momentum/momentum.env ]]; then
  install -o root -g root -m 0600 "$SCRIPT_DIR/momentum.env.example" /etc/momentum/momentum.env
  echo "Created /etc/momentum/momentum.env from the non-secret template; review it before starting the service."
else
  echo "Preserving existing /etc/momentum/momentum.env."
fi
install -o root -g root -m 0644 "$SCRIPT_DIR/systemd/momentum.service" /etc/systemd/system/momentum.service
if ! getent group momentum-flowable >/dev/null 2>&1; then groupadd --system momentum-flowable; fi
if ! id momentum-flowable >/dev/null 2>&1; then useradd --system --gid momentum-flowable --home-dir /var/lib/momentum-flowable --create-home --shell /usr/sbin/nologin momentum-flowable; fi
install -d -o root -g root -m 0755 /opt/momentum-flowable /opt/momentum-flowable/releases
install -d -o momentum-flowable -g momentum-flowable -m 0750 /var/lib/momentum-flowable
install -d -o root -g root -m 0750 /etc/momentum-flowable
if [[ ! -e /etc/momentum-flowable/momentum-flowable.env ]]; then
  install -o root -g root -m 0600 "$SCRIPT_DIR/momentum-flowable.env.example" /etc/momentum-flowable/momentum-flowable.env
  echo "Created /etc/momentum-flowable/momentum-flowable.env; set FLOWABLE_REST_PASSWORD before deploying the engine."
else
  echo "Preserving existing /etc/momentum-flowable/momentum-flowable.env."
fi
install -o root -g root -m 0644 "$SCRIPT_DIR/systemd/momentum-flowable.service" /etc/systemd/system/momentum-flowable.service
systemctl daemon-reload
systemctl enable momentum.service
if command -v nginx >/dev/null 2>&1; then
  echo "Nginx is installed. Copy nginx/momentum.conf.example only after reviewing its loopback-only listener."
else
  echo "Nginx is not installed. Install and configure it separately when a reviewed TLS/auth front proxy is ready."
fi
if command -v redis-cli >/dev/null 2>&1 && redis-cli ping >/dev/null 2>&1; then
  echo "Redis is responding locally."
else
  echo "Redis is optional and is not currently responding; the app will use its in-process fallback until configured."
fi
echo "Bootstrap complete. Deploy a release before starting momentum.service."
