#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
release_dir="$repo_root/release"
package_path="$release_dir/calmread-chrome-extension-0.2.3-direct-action.zip"

mkdir -p "$release_dir"
rm -f "$package_path"

cd "$repo_root"
zip -qr "$package_path" \
  manifest.json \
  icons \
  vendor \
  src \
  backend/.env.example \
  backend/main.py \
  backend/ratelimit.py \
  backend/requirements.txt \
  backend/routers \
  backend/services \
  -x '*/__pycache__/*' 'backend/.DS_Store' 'src/popup.html' 'src/popup.js'

printf 'Created %s\n' "$package_path"
