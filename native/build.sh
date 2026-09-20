#!/bin/bash
# build.sh — compile DSH.app (native WKWebView shell for the DeepSeek Harness web UI)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$HERE/DSH.app"
mkdir -p "$APP/Contents/MacOS"
swiftc -O -o "$APP/Contents/MacOS/DSH" "$HERE/main.swift" -target arm64-apple-macos12.0
cp "$HERE/Info.plist" "$APP/Contents/Info.plist"
echo "built: $APP"
