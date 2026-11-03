#!/bin/bash
# Installs or updates Folio on macOS or Linux, with nothing else to install first:
#   curl -fsSL https://raw.githubusercontent.com/akamoe/research-platform/main/scripts/install.sh | bash
# It puts its own copy of Node.js and Folio in ~/Folio, makes a Folio app icon and opens Folio.
# Your projects stay in ~/ResearchPlatform; running this again updates Folio without touching them.
set -euo pipefail

FOLIO_HOME="${FOLIO_HOME:-$HOME/Folio}"
REPO="${FOLIO_REPO:-akamoe/research-platform}"
BRANCH="${FOLIO_BRANCH:-main}"

say() { printf '\n  %s\n' "$1"; }

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) say "This installer is for macOS and Linux. On Windows, see the README."; exit 1 ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) say "Sorry, Folio doesn't support this processor ($(uname -m))."; exit 1 ;;
esac

sha256() { if command -v shasum >/dev/null; then shasum -a 256 "$1"; else sha256sum "$1"; fi | cut -d' ' -f1; }

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$FOLIO_HOME"
NODE="$FOLIO_HOME/node/bin/node"

# 1. Node.js (latest 22.x LTS), checked against nodejs.org's checksums.
sums="$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt)"
line="$(printf '%s\n' "$sums" | grep -E " node-v[0-9.]+-$os-$arch\.tar\.gz$" | head -1)"
file="${line##* }"
version="${file#node-}"; version="${version%%-*}"
if [ ! -x "$NODE" ] || [ "$("$NODE" --version)" != "$version" ]; then
  say "Downloading Node.js $version..."
  curl -fSL --progress-bar "https://nodejs.org/dist/latest-v22.x/$file" -o "$tmp/$file"
  [ "$(sha256 "$tmp/$file")" = "${line%% *}" ] || { say "The Node.js download is damaged. Please try again."; exit 1; }
  tar -xzf "$tmp/$file" -C "$tmp"
  rm -rf "$FOLIO_HOME/node"
  mv "$tmp/${file%.tar.gz}" "$FOLIO_HOME/node"
fi

# 2. Folio itself. Stop a running copy first so it can be replaced.
[ -f "$FOLIO_HOME/app/scripts/launch.mjs" ] && "$NODE" "$FOLIO_HOME/app/scripts/launch.mjs" --stop >/dev/null 2>&1 || true
say "Downloading Folio..."
curl -fSL --progress-bar "https://codeload.github.com/$REPO/tar.gz/refs/heads/$BRANCH" -o "$tmp/folio.tar.gz"
mkdir "$tmp/src"
tar -xzf "$tmp/folio.tar.gz" -C "$tmp/src" --strip-components 1
rm -rf "$FOLIO_HOME/app"
mv "$tmp/src" "$FOLIO_HOME/app"

# 3. Install its parts, build it, make the icon and open it.
"$NODE" "$FOLIO_HOME/app/scripts/launch.mjs" --setup
"$NODE" "$FOLIO_HOME/app/scripts/shortcut.mjs"
"$NODE" "$FOLIO_HOME/app/scripts/launch.mjs" --background
say "Folio is installed and open in your browser. Next time, open it from its icon."
