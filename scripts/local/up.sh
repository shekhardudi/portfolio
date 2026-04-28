#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR/infra/local/docker"

docker compose -f docker-compose.local.yml up -d --build

echo "Local backend stack is starting on ports 8001, 8002, 8003"
