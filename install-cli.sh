#!/usr/bin/env bash
set -euo pipefail

REGISTRY="https://npm.pkg.github.com"
SCOPE="${QCC_LSP_SCOPE:-@vatsalsy}"
PACKAGE="${QCC_LSP_PACKAGE:-${SCOPE}/qcc-lsp}"
VERSION="${QCC_LSP_VERSION:-}"
TOKEN="${QCC_LSP_TOKEN:-${GITHUB_PAT_TOKEN:-${GITHUB_TOKEN:-${GH_TOKEN:-}}}}"

usage() {
  cat <<'EOF'
Usage: ./install-cli.sh [version]

Environment overrides:
  QCC_LSP_SCOPE    Scope to use (default: @vatsalsy)
  QCC_LSP_PACKAGE  Package name (default: @vatsalsy/qcc-lsp)
  QCC_LSP_VERSION  Version to install (e.g., 0.1.0)
  QCC_LSP_TOKEN    GitHub token with read:packages
  GITHUB_PAT_TOKEN GitHub PAT token with read:packages

If no token is provided, npm will prompt for login.
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -n "${1:-}" ]]; then
  VERSION="$1"
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but not found on PATH." >&2
  exit 1
fi

if [[ -n "$VERSION" ]]; then
  VERSION="${VERSION#v}"
  PACKAGE="${PACKAGE}@${VERSION}"
fi

npm config set "${SCOPE}:registry" "$REGISTRY"

if [[ -n "$TOKEN" ]]; then
  npm config set "//npm.pkg.github.com/:_authToken" "$TOKEN"
else
  echo "No token found. Running npm login for $SCOPE..."
  npm login --registry="$REGISTRY" --scope="$SCOPE"
fi

echo "Installing $PACKAGE from GitHub Packages..."
npm install -g "$PACKAGE"
echo "Installed $PACKAGE."
