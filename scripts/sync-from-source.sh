#!/usr/bin/env bash
# Re-pulls the latest backend code from ../ai-workspace/ into ./services/.
# Idempotent — safe to re-run. Skips Streamlit UIs and React frontends.
#
# Usage:
#   ./scripts/sync-from-source.sh                # syncs all three
#   ./scripts/sync-from-source.sh intelli-search # syncs one
#   SOURCE=/path/to/ai-workspace ./scripts/sync-from-source.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="${SOURCE:-$ROOT/../ai-workspace}"
TARGET="$ROOT/services"

if [[ ! -d "$SOURCE" ]]; then
  echo "ERROR: source not found at $SOURCE"
  echo "       set SOURCE=/abs/path/to/ai-workspace and re-run"
  exit 1
fi

RSYNC_FLAGS=(
  -a --delete
  --exclude='__pycache__'
  --exclude='*.pyc'
  --exclude='.pytest_cache'
  --exclude='.mypy_cache'
  --exclude='.coverage'
  --exclude='.venv/'
  --exclude='venv/'
  --exclude='.python-version'
  --exclude='outputs/'
  --exclude='output_markdown/'
  --exclude='.DS_Store'
  --exclude='*.log'
)

sync_intelli_search() {
  echo ">> intelli-search"
  rsync "${RSYNC_FLAGS[@]}" "$SOURCE/intelli-search/backend/"   "$TARGET/intelli-search/"
  rsync "${RSYNC_FLAGS[@]}" "$SOURCE/intelli-search/data-pipeline/" "$TARGET/intelli-search/data-pipeline/"
}

sync_agentic_hr() {
  echo ">> agentic-hr"
  rsync "${RSYNC_FLAGS[@]}" "$SOURCE/agentic_hr/backend/"   "$TARGET/agentic-hr/backend/"
  rsync "${RSYNC_FLAGS[@]}" "$SOURCE/agentic_hr/ingestion/" "$TARGET/agentic-hr/ingestion/"
  cp "$SOURCE/agentic_hr/init-db.sh" "$TARGET/agentic-hr/init-db.sh"
}

sync_linkedin_generator() {
  echo ">> linkedin-generator"
  rsync "${RSYNC_FLAGS[@]}" "$SOURCE/linkedin_post_generator/src/" "$TARGET/linkedin-generator/src/"
  cp "$SOURCE/linkedin_post_generator/pyproject.toml" "$TARGET/linkedin-generator/pyproject.toml"
}

case "${1:-all}" in
  intelli-search)      sync_intelli_search ;;
  agentic-hr)          sync_agentic_hr ;;
  linkedin-generator)  sync_linkedin_generator ;;
  all)
    sync_intelli_search
    sync_agentic_hr
    sync_linkedin_generator
    ;;
  *)
    echo "Unknown service: $1"
    echo "Usage: $0 [intelli-search|agentic-hr|linkedin-generator|all]"
    exit 1
    ;;
esac

echo "Done. Review with: git status"
