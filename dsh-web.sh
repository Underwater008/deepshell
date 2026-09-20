#!/bin/bash
# dsh-web.sh — run the official DeepSeek Harness web UI as a macOS service,
# with phone access over Wi-Fi (LAN) or internet (Cloudflare tunnel).
#
# Usage:
#   dsh-web.sh open        start if needed, open the UI in your browser (Dock app calls this)
#   dsh-web.sh install     install + start the launchd service (auto-start at login)
#   dsh-web.sh uninstall   stop and remove the launchd service
#   dsh-web.sh start|stop|restart|status|url
#   dsh-web.sh lan         enable phone access on your Wi-Fi and show the QR code
#   dsh-web.sh local       back to localhost-only
#   dsh-web.sh tunnel      enable phone access from anywhere (Cloudflare tunnel) + QR
#   dsh-web.sh tunnel stop disable the tunnel
#   dsh-web.sh qr          re-show the current phone-access QR code
#   dsh-web.sh run         foreground mode (launchd uses this; not for humans)
#
# NOTE: launchd-spawned processes may not read TCC-protected folders
# (Documents/Desktop/Downloads), so `install` copies this script to
# ~/Library/Application Support/dsh-web-launcher/ and launchd runs that copy.
# Edit the repo copy, then re-run `dsh-web.sh install` to refresh.
set -euo pipefail

# ---- config ---------------------------------------------------------------
DSH_VERSION_SPEC="@latest"        # pin a version instead: "@0.1.5-rc.2"
PORT=3080
FORWARD_PORT=3081
LABEL="local.dsh-web"
# ----------------------------------------------------------------------------

STATE_DIR="$HOME/Library/Application Support/dsh-web-launcher"
RUN_DIR="$STATE_DIR/run"
LOG="$RUN_DIR/dsh-web.log"
TUNNEL_LOG="$RUN_DIR/cloudflared.log"
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

lan_ip() { ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null; }

current_url() {
  grep -oE 'http://127\.0\.0\.1:[0-9]+/\?token=[A-Za-z0-9_-]+' "$LOG" 2>/dev/null | tail -1
}

wait_fresh_url() {  # call AFTER truncating $LOG + restarting; first URL found is the new one
  local u i
  for i in $(seq 1 90); do
    u=$(current_url || true)
    [ -n "$u" ] && { echo "$u"; return 0; }
    sleep 1
  done
  echo "timed out waiting for server; see $LOG" >&2
  return 1
}

qr_show() {
  echo "$1"
  if command -v qrencode >/dev/null 2>&1; then
    qrencode -t ANSIUTF8 "$1"
  else
    echo "(QR tool missing — install with: brew install qrencode)"
  fi
}

fresh_restart() {  # truncate log, restart service, wait for the new token URL
  : > "$LOG"
  launchctl kickstart -k "gui/$(id -u)/$LABEL"
  wait_fresh_url
}

cmd_run() {  # foreground; launchd manages this process
  ensure_env
  cd "$HOME"
  local args=(web --no-open --port "$PORT")
  local mode="local"
  [ -f "$STATE_DIR/mode" ] && mode=$(cat "$STATE_DIR/mode")
  if [ "$mode" = "lan" ]; then
    # upstream refuses --host 0.0.0.0 on purpose (RCE exposure); the harness
    # stays on 127.0.0.1 and a socat forwarder exposes LAN_IP:FORWARD_PORT
    local ip
    ip=$(lan_ip || true)
    [ -n "$ip" ] && args+=(--trusted-host "$ip:$FORWARD_PORT")
  fi
  if [ -f "$STATE_DIR/trusted-hosts" ]; then
    while IFS= read -r h; do
      [ -n "$h" ] && args+=(--trusted-host "$h")
    done < "$STATE_DIR/trusted-hosts"
  fi
  exec npx -y "@deepseek-ai/dsh${DSH_VERSION_SPEC}" "${args[@]}"
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

cmd_start() {
  launchctl enable "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl kickstart "gui/$(id -u)/$LABEL"
}

cmd_stop() {  # disable first, or KeepAlive resurrects it
  launchctl disable "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl kill SIGTERM "gui/$(id -u)/$LABEL" 2>/dev/null || true
}

cmd_restart() { launchctl kickstart -k "gui/$(id -u)/$LABEL"; }

cmd_status() {
  if is_up; then
    echo "running on port $PORT (mode: $(cat "$STATE_DIR/mode" 2>/dev/null || echo local))"
    current_url || true
    pgrep -f "cloudflared tunnel --url http://127.0.0.1:$PORT" >/dev/null 2>&1 && \
      echo "tunnel: $(head -1 "$STATE_DIR/trusted-hosts" 2>/dev/null)"
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
      : > "$LOG"
      cmd_start
    fi
  fi
  local u
  u=$(wait_fresh_url) || return 1
  open "$u"
  echo "$u"
}

cmd_ensure() {  # start if needed; print the current token URL; never opens a browser
  ensure_env
  if ! is_up; then
    if [ ! -f "$PLIST" ]; then
      cmd_install
    else
      : > "$LOG"
      cmd_start
    fi
  fi
  wait_fresh_url
}

cmd_lan() {
  ensure_env
  local ip
  ip=$(lan_ip) || { echo "no LAN IP found (en0/en1) — are you on Wi-Fi?" >&2; return 1; }
  command -v socat >/dev/null 2>&1 || { echo "socat missing — install with: brew install socat" >&2; return 1; }
  echo lan > "$STATE_DIR/mode"
  echo "restarting server (trusting $ip:$FORWARD_PORT)..."
  local u tok
  u=$(fresh_restart) || return 1
  if ! pgrep -f "socat TCP-LISTEN:$FORWARD_PORT" >/dev/null 2>&1; then
    nohup socat "TCP-LISTEN:$FORWARD_PORT,bind=$ip,fork,reuseaddr" "TCP:127.0.0.1:$PORT" > "$RUN_DIR/socat.log" 2>&1 &
  fi
  tok=$(grep -oE '\?token=[A-Za-z0-9_-]+' <<<"$u")
  u="http://$ip:$FORWARD_PORT/$tok"
  echo
  echo "Phone access (same Wi-Fi as this Mac):"
  qr_show "$u"
  echo
  echo "Scan with your phone camera. The URL carries the login token — treat it like a password."
  echo "'$0 local' to return to localhost-only."
}

cmd_local() {
  ensure_env
  echo local > "$STATE_DIR/mode"
  rm -f "$STATE_DIR/trusted-hosts"
  pkill -f "cloudflared tunnel --url http://127.0.0.1:$PORT" 2>/dev/null || true
  pkill -f "socat TCP-LISTEN:$FORWARD_PORT" 2>/dev/null || true
  fresh_restart >/dev/null
  echo "back to localhost-only mode (tunnel off, LAN off)"
}

cmd_tunnel() {
  ensure_env
  if [ "${1:-}" = "stop" ]; then
    pkill -f "cloudflared tunnel --url http://127.0.0.1:$PORT" 2>/dev/null || true
    rm -f "$STATE_DIR/trusted-hosts"
    echo "tunnel stopped (trusted host cleared; applies fully on next restart)"
    return 0
  fi
  command -v cloudflared >/dev/null 2>&1 || {
    echo "cloudflared missing — install with: brew install --cask cloudflared" >&2
    return 1
  }
  if ! pgrep -f "cloudflared tunnel --url http://127.0.0.1:$PORT" >/dev/null 2>&1; then
    : > "$TUNNEL_LOG"
    nohup cloudflared tunnel --url "http://127.0.0.1:$PORT" --no-autoupdate > "$TUNNEL_LOG" 2>&1 &
  fi
  local host="" i
  for i in $(seq 1 45); do
    host=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | head -1)
    [ -n "$host" ] && break
    sleep 1
  done
  [ -n "$host" ] || { echo "tunnel failed to start; see $TUNNEL_LOG" >&2; return 1; }
  echo "${host#https://}" > "$STATE_DIR/trusted-hosts"
  echo "tunnel up: $host — restarting server to trust that host..."
  local u tok
  u=$(fresh_restart) || return 1
  tok=$(grep -oE '\?token=[A-Za-z0-9_-]+' <<<"$u")
  echo
  echo "Phone access (anywhere, via Cloudflare quick tunnel):"
  qr_show "$host/$tok"
  echo
  echo "Scan with your phone camera. URL+token is the credential — share carefully."
  echo "'$0 tunnel stop' to disable."
}

cmd_qr() {
  ensure_env
  local u mode="local" tok host ip
  u=$(current_url) || { echo "server not running / no token yet" >&2; return 1; }
  [ -f "$STATE_DIR/mode" ] && mode=$(cat "$STATE_DIR/mode")
  tok=$(grep -oE '\?token=[A-Za-z0-9_-]+' <<<"$u")
  if [ -f "$STATE_DIR/trusted-hosts" ] && pgrep -f "cloudflared tunnel --url http://127.0.0.1:$PORT" >/dev/null 2>&1; then
    host=$(head -1 "$STATE_DIR/trusted-hosts")
    qr_show "https://$host/$tok"
  elif [ "$mode" = "lan" ]; then
    ip=$(lan_ip || true)
    [ -n "$ip" ] && u="http://$ip:$FORWARD_PORT/$tok"
    qr_show "$u"
  else
    qr_show "$u"
    echo "(localhost-only — use '$0 lan' or '$0 tunnel' for phone access)"
  fi
}

case "${1:-open}" in
  run|install|uninstall|start|stop|restart|status|open|ensure|lan|local|qr) "cmd_$1" ;;
  tunnel) cmd_tunnel "${2:-}" ;;
  url) current_url ;;
  *) echo "usage: $0 {open|install|uninstall|start|stop|restart|status|url|lan|local|tunnel [stop]|qr}" >&2; exit 2 ;;
esac
