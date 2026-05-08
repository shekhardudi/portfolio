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
DOCKER_NO_CACHE="${DOCKER_NO_CACHE:-1}"

case "$TARGET" in
  all)      COMPOSE_TARGETS="" ;;
  web)      COMPOSE_TARGETS="web" ;;
  services) COMPOSE_TARGETS="intelli-search agentic-hr linkedin-generator" ;;
  *) echo "unknown target: $TARGET (expected all|web|services)" >&2; exit 2 ;;
esac

REPO=/opt/portfolio

# SSM/non-interactive runs may execute under users that don't yet trust this
# repo path after ownership/bootstrap changes.
git config --global --add safe.directory "$REPO" || true

cd "$REPO"
if [[ "${SKIP_GIT_SYNC:-0}" == "1" ]]; then
  echo "SKIP_GIT_SYNC=1; using existing files in $REPO"
else
  git fetch origin --prune --tags

  # Branch refs: use remote-tracking branch so host local state can't go stale.
  if git show-ref --verify --quiet "refs/remotes/origin/$REF"; then
    git checkout -B "$REF" "origin/$REF"
  else
    # Tag/SHA refs: detach checkout to exact object requested.
    git checkout --detach "$REF"
  fi
fi

cd "$REPO/infra/single-ec2/docker"
sudo cp nginx/nginx.conf /etc/nginx/nginx.conf
sudo nginx -t
sudo nginx -s reload

# Build options: default to fresh builds for CI/CD correctness.
BUILD_FLAGS=(--pull)
if [[ "$DOCKER_NO_CACHE" == "1" ]]; then
  BUILD_FLAGS+=(--no-cache)
fi

# shellcheck disable=SC2086  # intentional word-splitting on $COMPOSE_TARGETS
docker compose -f docker-compose.prod.yml pull $COMPOSE_TARGETS || true
docker compose -f docker-compose.prod.yml build "${BUILD_FLAGS[@]}" $COMPOSE_TARGETS
docker compose -f docker-compose.prod.yml up -d --no-build --force-recreate $COMPOSE_TARGETS

docker system prune -f
echo "deploy complete: ref=$REF target=$TARGET at $(date -u +%FT%TZ)"
