#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_DIR="$ROOT_DIR/infra/local/docker/env"

cp -n "$ENV_DIR/intelli-search.env.example" "$ENV_DIR/intelli-search.env"
cp -n "$ENV_DIR/agentic-hr.env.example" "$ENV_DIR/agentic-hr.env"
cp -n "$ENV_DIR/linkedin-generator.env.example" "$ENV_DIR/linkedin-generator.env"

echo "Local env files are ready in: $ENV_DIR"
echo "Edit *.env files before running local stack."
