#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
TARGET="${1:-}"
SSH_PORT="${2:-22}"
if [[ -z "$TARGET" ]]; then echo "Usage: $0 <ssh-user@ubuntu-host> [ssh-port]" >&2; exit 2; fi
if [[ "$TARGET" == -* || ! "$TARGET" =~ ^[A-Za-z0-9._@:-]+$ ]]; then echo "SSH target contains unsupported characters." >&2; exit 2; fi
if [[ ! "$SSH_PORT" =~ ^[0-9]{1,5}$ ]] || (( SSH_PORT < 1 || SSH_PORT > 65535 )); then echo "Invalid SSH port." >&2; exit 2; fi
command -v ssh >/dev/null 2>&1 && command -v scp >/dev/null 2>&1 || { echo "ssh and scp are required locally." >&2; exit 1; }
ID="$(date -u +%Y%m%dT%H%M%SZ)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cp -a "$SCRIPT_DIR" "$WORK/ubuntu"
tar -C "$WORK" -czf "$WORK/bootstrap.tar.gz" ubuntu
REMOTE="/tmp/momentum-bootstrap-$ID.tar.gz"
DEST="/tmp/momentum-bootstrap-$ID"
ssh -p "$SSH_PORT" "$TARGET" 'sudo -n true'
scp -P "$SSH_PORT" "$WORK/bootstrap.tar.gz" "$TARGET:$REMOTE"
ssh -p "$SSH_PORT" "$TARGET" "sudo -n mkdir -p '$DEST' && sudo -n tar --no-same-owner --no-same-permissions -xzf '$REMOTE' -C '$DEST' && sudo -n bash '$DEST/ubuntu/bootstrap.sh' && sudo -n rm -rf '$DEST' '$REMOTE'"
