#!/bin/bash
# dsh-web.sh — run the official DeepSeek Harness web UI as a macOS service.
#
# Usage:
#   dsh-web.sh open       start if needed, open the UI in your browser (what the Dock app calls)
#   dsh-web.sh install    install + start the launchd service (auto-start at login)
#   dsh-web.sh uninstall  stop and remove the launchd service
#   dsh-web.sh start|stop|restart|status|url
#   dsh-web.sh run        foreground mode (launchd uses this; not for humans)
#
# NOTE: launchd-spawned processes may not read TCC-protected folders
# (Documents/Desktop/Downloads), so `install` copies this script to
# ~/Library/Application Support/dsh-web-launcher/ and launchd runs that copy.
# Edit the repo copy, then re-run `dsh-web.sh install` to refresh.
set -euo pipefail

# ---- config ---------------------------------------------------------------
DSH_VERSION_SPEC="@latest"        # pin a version instead: "@0.1.5-rc.2"
PORT=3080
LABEL="local.dsh-web"
# ----------------------------------------------------------------------------

STATE_DIR="$HOME/Library/Application Support/dsh-web-launcher"
RUN_DIR="$STATE_DIR/run"
LOG="$RUN_DIR/dsh-web.log"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

ensure_env() {
  # Newest nvm-installed node wins; launchd gives us a bare PATH otherwise.
  local d
  d=$(ls -d "$HOME"/.nvm/versions/node/v*/bin 2>/dev/null | sort -V | tail -1 || true)
  if [ -n "$d" ]; then
    export PATH="$d:/opt/homebrew/bin:/usr/local/bin:$PATH"
  fi
  mkdir -p "$RUN_DIR"
}

is_up() { lsof -iTCP:"$PORT" -sTCP:LISTEN -P >/dev/null 2>&1; }

current_url() {
  grep -oE 'http://127\.0\.0\.1:[0-9]+/\?token=[A-Za-z0-9_-]+' "$LOG" 2>/dev/null | tail -1
}

cmd_run() {  # foreground; launchd manages this process
  ensure_env
  cd "$HOME"
  exec npx -y "@deepseek-ai/dsh${DSH_VERSION_SPEC}" web --no-open --port "$PORT"
}

cmd_install() {
  ensure_env
  mkdir -p "$STATE_DIR"
  if [ "$SELF" != "$STATE_DIR/dsh-web.sh" ]; then
    cp "$SELF" "$STATE_DIR/dsh-web.sh"
    chmod +x "$STATE_DIR/dsh-web.sh"
  fi
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$STATE_DIR/dsh-web.sh</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>$LOG</string>
  <key>StandardErrorPath</key>
  <string>$LOG</string>
  <key>WorkingDirectory</key>
  <string>$HOME</string>
</dict>
</plist>
EOF
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "installed and started: $LABEL (auto-starts at login)"
  echo "runtime copy: $STATE_DIR/dsh-web.sh"
}

cmd_uninstall() {
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "uninstalled: $LABEL"
}

cmd_start()   { launchctl kickstart "gui/$(id -u)/$LABEL"; }
cmd_stop()    { launchctl kill SIGTERM "gui/$(id -u)/$LABEL" 2>/dev/null || true; }
cmd_restart() { cmd_stop; sleep 1; cmd_start; }

cmd_status() {
  if is_up; then
    echo "running on port $PORT"
    current_url || true
  else
    echo "not running"
  fi
}

cmd_open() {
  ensure_env
  if ! is_up; then
    if [ ! -f "$PLIST" ]; then
      cmd_install
    else
      : > "$LOG"   # fresh log so we read THIS launch's token, not a stale one
      cmd_start
    fi
  fi
  local u i
  for i in $(seq 1 120); do
    u=$(current_url || true)
    if [ -n "$u" ]; then
      open "$u"
      echo "$u"
      return 0
    fi
    sleep 1
  done
  echo "timed out waiting for server; check $LOG" >&2
  return 1
}

case "${1:-open}" in
  run|install|uninstall|start|stop|restart|status|open) "cmd_$1" ;;
  url) current_url ;;
  *) echo "usage: $0 {open|install|uninstall|start|stop|restart|status|url}" >&2; exit 2 ;;
esac
