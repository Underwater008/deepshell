#!/bin/bash
# deepshell.sh — run the official DeepSeek Harness web UI as a macOS service,
# with phone access over the internet (Tailscale Funnel).
#
# Usage:
#   deepshell.sh open        start if needed, open the UI in your browser (Dock app calls this)
#   deepshell.sh install     install + start the launchd service (auto-start at login)
#   deepshell.sh uninstall   stop and remove the launchd service
#   deepshell.sh start|stop|restart|status|url
#   deepshell.sh local       back to localhost-only
#   deepshell.sh tunnel      enable phone access from anywhere (Tailscale Funnel) + QR
#   deepshell.sh tunnel stop disable the tunnel
#   deepshell.sh qr          re-show the current phone-access QR code
#   deepshell.sh phone install  put the same controls on a Settings → Plugins card in the web UI
#   deepshell.sh video install  add the video_qa tool (ask questions about local video files)
#   deepshell.sh video test <clip>  smoke-test the installed video route without the harness
#   deepshell.sh run         foreground mode (launchd uses this; not for humans)
#
# NOTE: launchd-spawned processes may not read TCC-protected folders
# (Documents/Desktop/Downloads), so `install` copies this script to
# ~/Library/Application Support/deepshell/ and launchd runs that copy.
# Edit the repo copy, then re-run `deepshell.sh install` to refresh.
set -euo pipefail

# ---- config ---------------------------------------------------------------
DSH_VERSION_SPEC="@latest"        # pin a version instead: "@0.1.5-rc.2"
PORT=3080
LABEL="local.deepshell"
# ----------------------------------------------------------------------------

STATE_DIR="$HOME/Library/Application Support/deepshell"
RUN_DIR="$STATE_DIR/run"
LOG="$RUN_DIR/deepshell.log"
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
  phone_runtime prepare
  phone_runtime resume >&2 || true
  local args=(web --no-open --port "$PORT")
  if [ -f "$STATE_DIR/trusted-hosts" ]; then
    while IFS= read -r h; do
      [ -n "$h" ] && args+=(--trusted-host "$h")
    done < "$STATE_DIR/trusted-hosts"
  fi
  exec npx -y "@deepseek-ai/dsh${DSH_VERSION_SPEC}" "${args[@]}"
}

phone_runtime() {
  local runtime="$STATE_DIR/phone-runtime/scripts/phone-runtime.mjs"
  if [ ! -f "$runtime" ]; then
    case "$1" in
      prepare|resume|suspend|disable|host) return 0 ;;
      *) echo "Phone runtime missing. Run deepshell.sh phone install from the repo." >&2; return 1 ;;
    esac
  fi
  node "$runtime" "$1" "$STATE_DIR" "$PORT"
}

sync_runtime() {
  mkdir -p "$STATE_DIR"
  if [ "$SELF" != "$STATE_DIR/deepshell.sh" ]; then
    cp "$SELF" "$STATE_DIR/deepshell.sh"
    chmod +x "$STATE_DIR/deepshell.sh"
  fi
  local source_dir="$(dirname "$SELF")/packages/dsh-phone-connect" file
  if [ -f "$source_dir/scripts/phone-runtime.mjs" ]; then
    mkdir -p "$STATE_DIR/phone-runtime/lib" "$STATE_DIR/phone-runtime/scripts"
    for file in package.json lib/persistent.js lib/tailscale.js scripts/phone-runtime.mjs; do
      cp "$source_dir/$file" "$STATE_DIR/phone-runtime/$file"
    done
  fi
}

cmd_install() {
  ensure_env
  sync_runtime
  # The settings card is part of DeepShell, so install it with the service.
  if [ -f "$(dirname "$SELF")/packages/dsh-phone-connect/package.json" ]; then
    phone_wire_profile
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
    <string>$STATE_DIR/deepshell.sh</string>
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
  launchctl enable "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$PLIST"
  echo "installed and started: $LABEL (auto-starts at login)"
  echo "runtime copy: $STATE_DIR/deepshell.sh"
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

cmd_stop_all() {  # quit path: harness service + phone forwarders + search sidecar
  ensure_env
  cmd_stop
  phone_runtime suspend >&2 || true
  pkill -f "cloudflared tunnel --url http://127.0.0.1:$PORT" 2>/dev/null || true
  pkill -f "socat TCP-LISTEN:3081" 2>/dev/null || true
  # stop the sidecar by container name: this script may be the launchd/app
  # copy in ~/Library/Application Support/deepshell, without the repo's
  # search/ folder nearby
  docker stop deepshell-searxng >/dev/null 2>&1 || true
  echo "stopped: harness service, phone access, search sidecar"
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

cmd_local() {
  ensure_env
  phone_runtime disable
  echo local > "$STATE_DIR/mode"
  rm -f "$STATE_DIR/trusted-hosts"
  pkill -f "cloudflared tunnel --url http://127.0.0.1:$PORT" 2>/dev/null || true
  pkill -f "socat TCP-LISTEN:3081" 2>/dev/null || true
  fresh_restart >/dev/null
  echo "phone access disabled (localhost only)"
}

cmd_tunnel() {
  ensure_env
  if [ "${1:-}" = "stop" ]; then
    cmd_local
    return 0
  fi
  local host u tok
  host=$(phone_runtime enable) || return 1
  pkill -f "cloudflared tunnel --url http://127.0.0.1:$PORT" 2>/dev/null || true
  pkill -f "socat TCP-LISTEN:3081" 2>/dev/null || true
  echo "restarting server to trust the permanent phone address..."
  u=$(fresh_restart) || return 1
  tok=$(grep -oE '\?token=[A-Za-z0-9_-]+' <<<"$u")
  echo "Open this link in Chrome or Safari once, then bookmark the page:"
  qr_show "${host}${tok}"
  echo "Your saved address stays the same after restarting DeepShell."
}

# ---- search sidecar (self-hosted SearXNG for the harness's web_search) ----

SEARCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/search"
# 8890, not the common 8888: owning the instance means owning the engine set.
SEARCH_PORT=8890

# launchd runs a bare copy of this script without the repo's search/ folder;
# fail loud instead of compose-ing against nothing.
require_search_dir() {
  [ -f "$SEARCH_DIR/compose.yml" ] || {
    echo "search: $SEARCH_DIR/compose.yml not found — run '$0 search' from the deepshell repo" >&2
    return 1
  }
}

search_settings() {  # seed settings.yml from the template on first install
  if [ ! -f "$SEARCH_DIR/settings/settings.yml" ]; then
    command -v openssl >/dev/null 2>&1 || { echo "openssl missing" >&2; return 1; }
    sed "s/__SEARXNG_SECRET_KEY__/$(openssl rand -hex 32)/" \
      "$SEARCH_DIR/settings/settings.yml.template" > "$SEARCH_DIR/settings/settings.yml"
    echo "seeded $SEARCH_DIR/settings/settings.yml with a fresh secret_key"
  fi
}

# The harness side of the sidecar: install the provider plugin into the web
# profile and add the patch rows routing web_search to it. Idempotent — every
# step is skipped when already present, so this runs on every search install.
search_wire_profile() {
  ensure_env
  local repo_dir profile_dir patch_file
  repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  profile_dir="$HOME/.dsh/profiles/web"
  patch_file="$profile_dir/cordis.patch.yml"

  [ -f "$repo_dir/packages/dsh-web-search-searxng/package.json" ] || {
    echo "search: $repo_dir/packages/dsh-web-search-searxng missing — run '$0 search' from the deepshell repo" >&2
    return 1
  }

  if ! grep -q '"dsh-web-search-searxng"' "$profile_dir/package.json" 2>/dev/null; then
    echo "search: installing the provider plugin into the web profile..."
    if ! npx -y "@deepseek-ai/dsh${DSH_VERSION_SPEC}" plugin --profile web add \
        "file:$repo_dir/packages/dsh-web-search-searxng"; then
      echo "search: plugin install failed — run '$0 install' first so the profile exists" >&2
      return 1
    fi
  fi

  if ! grep -q 'web-search-searxng' "$patch_file" 2>/dev/null; then
    local rows
    rows="$(cat <<EOF

# DeepShell search sidecar: route the native web_search tool to the
# self-hosted SearXNG provider (packages/dsh-web-search-searxng in the
# deepshell repo) instead of the keyed DeepSeek endpoint. fetch stays on the
# built-in anonymous HTTP provider.
- id: web
  config:
    searchProvider: searxng-local
    fetchProvider: http

- insert:
    - id: web-search-searxng
      name: dsh-web-search-searxng
      config:
        baseURL: http://127.0.0.1:$SEARCH_PORT
EOF
)"
    if [ -f "$patch_file" ] && grep -qE '^\[\][[:space:]]*$' "$patch_file"; then
      # pristine stub: keep the header comments, drop the empty list marker
      sed -i '' -e '/^\[\][[:space:]]*$/d' "$patch_file"
      printf '%s\n' "$rows" >> "$patch_file"
    elif [ -f "$patch_file" ]; then
      printf '%s\n' "$rows" >> "$patch_file"
    else
      printf '# DeepShell profile patch layer (created by deepshell.sh search install)\n%s\n' "$rows" > "$patch_file"
    fi
    echo "search: harness wired in $patch_file (web_search -> searxng-local on :$SEARCH_PORT)"
  fi
}

cmd_search() {
  command -v docker >/dev/null 2>&1 || { echo "docker missing — install Docker Desktop: brew install --cask docker" >&2; return 1; }
  require_search_dir || return 1
  case "${1:-status}" in
    install)
      search_settings || return 1
      if curl -sf -o /dev/null "http://127.0.0.1:$SEARCH_PORT/healthz" 2>/dev/null && \
         ! docker ps -a --format '{{.Names}}' | grep -qx deepshell-searxng; then
        echo "searxng: a healthy instance already answers on 127.0.0.1:$SEARCH_PORT — adopting it"
      else
        docker compose -f "$SEARCH_DIR/compose.yml" pull
        docker compose -f "$SEARCH_DIR/compose.yml" up -d
      fi
      search_wire_profile || return 1
      cmd_search status
      echo "note: web_search works after the live patch reload; '$0 restart' loads the Settings card"
      ;;
    start|up)   docker compose -f "$SEARCH_DIR/compose.yml" up -d ;;
    stop)       docker compose -f "$SEARCH_DIR/compose.yml" stop ;;
    down)       docker compose -f "$SEARCH_DIR/compose.yml" down ;;
    restart)    docker compose -f "$SEARCH_DIR/compose.yml" restart ;;
    logs)       docker compose -f "$SEARCH_DIR/compose.yml" logs -f ;;
    status)
      if curl -sf -o /dev/null "http://127.0.0.1:$SEARCH_PORT/healthz" 2>/dev/null; then
        echo "searxng: up on http://127.0.0.1:$SEARCH_PORT"
        local n
        n=$(curl -sf "http://127.0.0.1:$SEARCH_PORT/search?q=test&format=json" | \
            python3 -c "import json,sys; print(len(json.load(sys.stdin).get('results',[])))" 2>/dev/null)
        [ -n "$n" ] && echo "query test: $n results for 'test'"
      else
        echo "searxng: not running (install with: $0 search install)"
      fi
      if grep -q 'web-search-searxng' "$HOME/.dsh/profiles/web/cordis.patch.yml" 2>/dev/null; then
        echo "harness wiring: present (web_search -> searxng-local)"
      else
        echo "harness wiring: MISSING (run: $0 search install)"
      fi
      ;;
    *) echo "usage: $0 search {install|start|stop|restart|logs|status}" >&2; return 2 ;;
  esac
}

# ---- phone-connect settings card (in-UI controls for tunnel/local) ----
#
# The Phone menu and `tunnel|local` subcommands stay the primary path;
# this installs packages/dsh-phone-connect into the web profile so the same
# actions exist as a card under Settings → Plugins. The package's host half
# serves /api/phone-connect (GET status + QR, POST mode), writes the same
# state files as cmd_tunnel/cmd_local, and kickstarts this same
# launchd service — so CLI, menu bar, and card never disagree.

phone_wire_profile() {
  ensure_env
  local repo_dir profile_dir patch_file
  repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  profile_dir="$HOME/.dsh/profiles/web"
  patch_file="$profile_dir/cordis.patch.yml"

  [ -f "$repo_dir/packages/dsh-phone-connect/package.json" ] || {
    echo "phone: $repo_dir/packages/dsh-phone-connect missing — run '$0 phone install' from the deepshell repo" >&2
    return 1
  }

  if ! grep -q '"dsh-phone-connect"' "$profile_dir/package.json" 2>/dev/null; then
    echo "phone: installing the settings-card plugin into the web profile..."
    if ! npx -y "@deepseek-ai/dsh${DSH_VERSION_SPEC}" plugin --profile web add \
        "file:$repo_dir/packages/dsh-phone-connect"; then
      echo "phone: plugin install failed — run '$0 install' first so the profile exists" >&2
      return 1
    fi
  fi

  # Local file packages are installed as copies, not live source links.
  # Refresh existing installs as well as new ones before restarting.
  local installed="$profile_dir/node_modules/dsh-phone-connect" file
  mkdir -p "$installed/lib"
  for file in package.json index.js lib/client.js lib/persistent.js lib/tailscale.js; do
    if ! cmp -s "$repo_dir/packages/dsh-phone-connect/$file" "$installed/$file"; then
      cp "$repo_dir/packages/dsh-phone-connect/$file" "$installed/$file"
    fi
  done

  if ! grep -q 'dsh-phone-connect' "$patch_file" 2>/dev/null; then
    local rows
    rows="$(cat <<EOF

# DeepShell phone-connect card: Settings → Plugins gets remote access /
# off controls with a QR code (packages/dsh-phone-connect
# in the deepshell repo). Applies through the same state files and launchd
# service as deepshell.sh tunnel|local.
- insert:
    - id: phone-connect
      name: dsh-phone-connect
      config:
        port: $PORT
EOF
)"
    if [ -f "$patch_file" ] && grep -qE '^\[\][[:space:]]*$' "$patch_file"; then
      sed -i '' -e '/^\[\][[:space:]]*$/d' "$patch_file"
      printf '%s\n' "$rows" >> "$patch_file"
    elif [ -f "$patch_file" ]; then
      printf '%s\n' "$rows" >> "$patch_file"
    else
      printf '# DeepShell profile patch layer (created by deepshell.sh phone install)\n%s\n' "$rows" > "$patch_file"
    fi
    echo "phone: harness wired in $patch_file"
  fi
}

cmd_phone() {
  case "${1:-status}" in
    install)
      phone_wire_profile || return 1
      sync_runtime
      if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
        cmd_start
        fresh_restart >/dev/null
        echo "phone: restarted the harness; reopen Settings → Plugins to load the card"
      else
        echo "phone: run '$0 install' to start the harness with the card"
      fi
      cmd_phone status
      ;;
    status)
      ensure_env
      phone_runtime status
      if grep -q 'dsh-phone-connect' "$HOME/.dsh/profiles/web/cordis.patch.yml" 2>/dev/null; then
        echo "harness wiring: present (/api/phone-connect, card key phone-connect)"
      else
        echo "harness wiring: MISSING (run: $0 phone install)"
      fi
      ;;
    *) echo "usage: $0 phone {install|status}" >&2; return 2 ;;
  esac
}

# ---- video_qa tool (local video understanding through video-capable Kimi) ----
#
# packages/dsh-video-qa-moonshot registers a `video_qa` tool: the agent hands
# it a local video path and a question, the plugin sends the video to the
# configured OpenAI-compatible endpoint, and the answer comes back as tool
# text. The seeded route is Moonshot's official API (upload -> ms:// ref);
# any OpenAI-compatible K3 deployment (RunPod, Modal with video enabled,
# self-hosted vLLM) works by editing baseURL/apiKeyEnv/model in the row.

video_row_value() {  # read one scalar from the installed video-qa patch row
  awk '/id: video-qa-moonshot/,/^$/' "$HOME/.dsh/profiles/web/cordis.patch.yml" 2>/dev/null \
    | grep -m1 "^[[:space:]]*$1:" | sed "s/^[[:space:]]*$1:[[:space:]]*//"
}

video_wire_profile() {
  ensure_env
  local repo_dir profile_dir patch_file
  repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  profile_dir="$HOME/.dsh/profiles/web"
  patch_file="$profile_dir/cordis.patch.yml"

  [ -f "$repo_dir/packages/dsh-video-qa-moonshot/package.json" ] || {
    echo "video: $repo_dir/packages/dsh-video-qa-moonshot missing — run '$0 video install' from the deepshell repo" >&2
    return 1
  }

  if ! grep -q '"dsh-video-qa-moonshot"' "$profile_dir/package.json" 2>/dev/null; then
    echo "video: installing the video_qa plugin into the web profile..."
    if ! npx -y "@deepseek-ai/dsh${DSH_VERSION_SPEC}" plugin --profile web add \
        "file:$repo_dir/packages/dsh-video-qa-moonshot"; then
      echo "video: plugin install failed — run '$0 install' first so the profile exists" >&2
      return 1
    fi
  fi

  if ! grep -q 'video-qa-moonshot' "$patch_file" 2>/dev/null; then
    local rows
    rows="$(cat <<EOF

# DeepShell video_qa tool: ask questions about local video files through a
# video-capable Kimi model (packages/dsh-video-qa-moonshot in the deepshell
# repo). Default route is the official Moonshot API (upload + ms:// reference);
# point baseURL/apiKeyEnv/model at any OpenAI-compatible K3 deployment
# (RunPod, Modal with video enabled, self-hosted vLLM) for inline base64.
- insert:
    - id: video-qa-moonshot
      name: dsh-video-qa-moonshot
      config:
        baseURL: https://api.moonshot.ai/v1
        apiKeyEnv: MOONSHOT_API_KEY
        model: kimi-k3
EOF
)"
    if [ -f "$patch_file" ] && grep -qE '^\[\][[:space:]]*$' "$patch_file"; then
      # pristine stub: keep the header comments, drop the empty list marker
      sed -i '' -e '/^\[\][[:space:]]*$/d' "$patch_file"
      printf '%s\n' "$rows" >> "$patch_file"
    elif [ -f "$patch_file" ]; then
      printf '%s\n' "$rows" >> "$patch_file"
    else
      printf '# DeepShell profile patch layer (created by deepshell.sh video install)\n%s\n' "$rows" > "$patch_file"
    fi
    echo "video: harness wired in $patch_file (video_qa, default route api.moonshot.ai)"
  fi
}

cmd_video() {
  local repo_dir
  repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  case "${1:-status}" in
    install)
      video_wire_profile || return 1
      cmd_video status
      echo "note: video_qa registers on the live patch reload. Add a key for the row's apiKeyEnv"
      echo "      (Settings -> Models, or ~/.dsh/.credentials.yaml), or edit the row's"
      echo "      baseURL/apiKeyEnv/model to point at your own endpoint."
      echo "      Try: $0 video test /path/to/clip.mp4"
      ;;
    test)
      local clip="${2:-}"
      [ -n "$clip" ] || { echo "usage: $0 video test <clip> [smoke-test flags]" >&2; return 2; }
      [ -f "$repo_dir/packages/dsh-video-qa-moonshot/scripts/smoke-test.mjs" ] || {
        echo "video: smoke-test.mjs missing — run '$0 video test' from the deepshell repo" >&2
        return 1
      }
      local base key model
      base=$(video_row_value baseURL); base=${base:-https://api.moonshot.ai/v1}
      key=$(video_row_value apiKeyEnv); key=${key:-MOONSHOT_API_KEY}
      model=$(video_row_value model); model=${model:-kimi-k3}
      node "$repo_dir/packages/dsh-video-qa-moonshot/scripts/smoke-test.mjs" \
        --path "$clip" --base-url "$base" --key-env "$key" --model "$model" "${@:3}"
      ;;
    status)
      if grep -q 'video-qa-moonshot' "$HOME/.dsh/profiles/web/cordis.patch.yml" 2>/dev/null; then
        echo "harness wiring: present (video_qa; route: $(video_row_value baseURL), key: $(video_row_value apiKeyEnv), model: $(video_row_value model))"
      else
        echo "harness wiring: MISSING (run: $0 video install)"
      fi
      ;;
    *) echo "usage: $0 video {install|status|test <clip> [flags]}" >&2; return 2 ;;
  esac
}

cmd_qr() {
  ensure_env
  local u tok host
  u=$(current_url) || { echo "server not running / no token yet" >&2; return 1; }
  tok=$(grep -oE '\?token=[A-Za-z0-9_-]+' <<<"$u")
  host=$(phone_runtime host)
  if [ -n "$host" ]; then
    qr_show "https://$host/$tok"
  elif [ -f "$STATE_DIR/trusted-hosts" ] && pgrep -f "cloudflared tunnel --url http://127.0.0.1:$PORT" >/dev/null 2>&1; then
    host=$(head -1 "$STATE_DIR/trusted-hosts")
    qr_show "https://$host/$tok"
  else
    qr_show "$u"
    echo "(localhost-only — use '$0 tunnel' for phone access)"
  fi
}

case "${1:-open}" in
  run|install|uninstall|start|stop|stop-all|restart|status|open|ensure|local|qr) "cmd_${1//-/_}" ;;
  tunnel) cmd_tunnel "${2:-}" ;;
  search) cmd_search "${2:-}" ;;
  phone) cmd_phone "${2:-}" ;;
  video) cmd_video "${@:2}" ;;
  url) current_url ;;
  *) echo "usage: $0 {open|install|uninstall|start|stop|stop-all|restart|status|url|local|tunnel [stop]|search [install|start|stop|down|restart|logs|status]|phone [install|status]|video [install|status|test]|qr}" >&2; exit 2 ;;
esac
