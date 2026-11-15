#!/usr/bin/env bash
# 커밋 전 확인: 테스트 · 린트 · 프론트 빌드  (macOS / Linux / Git Bash)
set -euo pipefail
cd "$(dirname "$0")/.."
uv run pytest -q
uv run ruff check zscore tests
(cd dashboard && npm run build)
echo "OK — 커밋해도 됩니다"
