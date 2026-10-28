#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-}"
SSH_PORT="${2:-22}"
REMOTE_ROOT="/opt/momentum"
if [[ -z "$TARGET" ]]; then echo "Usage: $0 <ssh-user@ubuntu-host> [ssh-port]" >&2; exit 2; fi
if [[ "$TARGET" == -* || ! "$TARGET" =~ ^[A-Za-z0-9._@:-]+$ ]]; then echo "SSH target contains unsupported characters." >&2; exit 2; fi
if [[ ! "$SSH_PORT" =~ ^[0-9]{1,5}$ ]] || (( SSH_PORT < 1 || SSH_PORT > 65535 )); then echo "Invalid SSH port." >&2; exit 2; fi
if [[ "$REMOTE_ROOT" == / || ! "$REMOTE_ROOT" =~ ^/[A-Za-z0-9._/-]+$ || "$REMOTE_ROOT" == *"/../"* || "$REMOTE_ROOT" == */.. || "$REMOTE_ROOT" == *"/./"* || "$REMOTE_ROOT" == */. ]]; then echo "Remote root must be a safe absolute path below /." >&2; exit 2; fi
ssh -p "$SSH_PORT" "$TARGET" 'sudo -n true'
ssh -p "$SSH_PORT" "$TARGET" "sudo -n bash -s -- '$REMOTE_ROOT'" < "$SCRIPT_DIR/rollback-remote.sh"
