#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${1:-4173}"

echo "Serving ${ROOT_DIR} at http://127.0.0.1:${PORT}/preview.html"
cd "${ROOT_DIR}"
python3 -m http.server "${PORT}" --bind 127.0.0.1
