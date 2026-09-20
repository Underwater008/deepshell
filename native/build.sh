#!/bin/bash
# build.sh — compile DeepShell.app (native WKWebView shell for the DeepSeek Harness web UI)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$HERE/DeepShell.app"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -o "$APP/Contents/MacOS/DeepShell" "$HERE/main.swift" -target arm64-apple-macos12.0
cp "$HERE/Info.plist" "$APP/Contents/Info.plist"
# icon: regenerate from source when swift is available, else reuse committed AppIcon.icns
if command -v swift >/dev/null 2>&1; then
  TMP="$(mktemp -d)"
  swift "$HERE/makeicon.swift" "$TMP/icon_1024.png" >/dev/null
  mkdir -p "$TMP/AppIcon.iconset"
  for px in 16 32 128 256 512; do
    sips -z "$px" "$px" "$TMP/icon_1024.png" --out "$TMP/AppIcon.iconset/icon_${px}x${px}.png" >/dev/null
    dbl=$((px * 2))
    sips -z "$dbl" "$dbl" "$TMP/icon_1024.png" --out "$TMP/AppIcon.iconset/icon_${px}x${px}@2x.png" >/dev/null
  done
  iconutil -c icns "$TMP/AppIcon.iconset" -o "$HERE/AppIcon.icns"
  rm -rf "$TMP"
fi
[ -f "$HERE/AppIcon.icns" ] && cp "$HERE/AppIcon.icns" "$APP/Contents/Resources/AppIcon.icns"
touch "$APP"
echo "built: $APP"
