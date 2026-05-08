#!/usr/bin/env bash
# Runs ON the EC2 host (invoked by GitHub Actions via SSM SendCommand, or
# manually after `aws ssm start-session`). Pulls the requested ref, rebuilds
# the requested compose targets, and reloads nginx.
#
# Usage: deploy-on-ec2.sh <ref> <target>
#   ref    : git ref to check out (branch / tag / sha)
#   target : all | web | services
set -euxo pipefail

REF="${1:-main}"
TARGET="${2:-all}"

case "$TARGET" in
  all)      COMPOSE_TARGETS="" ;;
  web)      COMPOSE_TARGETS="web" ;;
  services) COMPOSE_TARGETS="intelli-search agentic-hr linkedin-generator" ;;
  *) echo "unknown target: $TARGET (expected all|web|services)" >&2; exit 2 ;;
esac

REPO=/opt/portfolio

cd "$REPO"
git fetch origin --prune
git checkout "$REF"
git pull --ff-only origin "$REF" || true

cd "$REPO/infra/single-ec2/docker"
sudo cp nginx/nginx.conf /etc/nginx/nginx.conf
sudo nginx -t
sudo nginx -s reload

# shellcheck disable=SC2086  # intentional word-splitting on $COMPOSE_TARGETS
docker compose -f docker-compose.prod.yml pull $COMPOSE_TARGETS || true
docker compose -f docker-compose.prod.yml up -d --build $COMPOSE_TARGETS

docker system prune -f
echo "deploy complete: ref=$REF target=$TARGET at $(date -u +%FT%TZ)"
