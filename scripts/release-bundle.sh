#!/usr/bin/env bash
set -euo pipefail

# Build npm release artifacts for GitHub Releases.
#
# Usage:
#   ./scripts/release-bundle.sh
#
# Output (under release/):
#   supabase-selfhosted-cli-<version>.tgz
#   SHA256SUMS

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
OUT_DIR="$ROOT/release"
PKG_NAME="supabase-selfhosted-cli"
TARBALL="${PKG_NAME}-${VERSION}.tgz"

echo "Building ${PKG_NAME} v${VERSION}..."

npm run test
npm run build

rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"

npm pack --pack-destination "$OUT_DIR" --silent

if [[ ! -f "$OUT_DIR/$TARBALL" ]]; then
  echo "Expected tarball not found: $OUT_DIR/$TARBALL" >&2
  exit 1
fi

(
  cd "$OUT_DIR"
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$TARBALL" > SHA256SUMS
  else
    sha256sum "$TARBALL" > SHA256SUMS
  fi
)

echo
echo "Release bundle ready:"
ls -lh "$OUT_DIR"
echo
echo "Upload release/$TARBALL and release/SHA256SUMS to GitHub Releases."
