#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TARGET_SCRIPT="$ROOT_DIR/scripts/single-ec2/sync-from-source.sh"

echo "Compatibility wrapper: delegating to scripts/single-ec2/sync-from-source.sh"
exec "$TARGET_SCRIPT" "$@"
