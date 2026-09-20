# dsh-web-launcher

Run the **official DeepSeek Harness web UI** (`@deepseek-ai/dsh` from npm) as a
macOS "app": auto-starts at login via launchd, opens from the Dock in a **native
window**, and offers **phone access** over Wi-Fi or internet — with zero
third-party wrapper code.

## What's here

| File | Purpose |
|---|---|
| `dsh-web.sh` | Service manager: start/stop/open, LAN + tunnel phone access. |
| `native/` | **DSH.app** — native WKWebView shell (Swift, ~150 lines, no Electron). Rebuild with `native/build.sh`. |
| `DSH Web.app` | Minimal AppleScript fallback launcher (opens in browser). |
| `run/` (in `~/Library/Application Support/dsh-web-launcher/`) | Runtime state: logs, mode, tunnel info. |

## Setup

```bash
./dsh-web.sh install      # install + start the launchd service (label: local.dsh-web)
./native/build.sh         # build the native DSH.app
```

Then drag `native/DSH.app` into the Dock. Done.

## Daily use

```bash
./dsh-web.sh open         # start if needed, open UI in browser
./dsh-web.sh status       # state, current token URL
./dsh-web.sh restart      # also pulls the newest @latest release
./dsh-web.sh uninstall
```

Or just click the Dock icon — the native app starts the service if needed and
opens the UI in its own window (no browser chrome).

## Phone access

Two modes, matching (and reusing) the official `--trusted-host` safety model.
The harness always stays on `127.0.0.1` — upstream intentionally refuses
`--host 0.0.0.0` ("it would expose remote code execution to the network"), so
we forward instead of bind.

```bash
./dsh-web.sh lan          # same-Wi-Fi phone access: socat forwarder on LAN_IP:3081 + QR
./dsh-web.sh tunnel       # anywhere access: Cloudflare quick tunnel + QR
./dsh-web.sh tunnel stop  # disable tunnel
./dsh-web.sh local        # back to localhost-only (stops both)
./dsh-web.sh qr           # re-show current access QR
```

- The tokenized URL **is** the login credential. Treat it like a password.
- Quick-tunnel hostnames change every run; the script re-trusts and restarts
  automatically, so each `tunnel` run prints a fresh QR.
- Requires: `brew install qrencode socat`, `brew install --cask cloudflared`
  (or the cloudflared binary from GitHub releases).
- For a *permanent* tunnel with a stable URL, use a named Cloudflare tunnel or
  Tailscale instead of the quick tunnel.

## Updates

`npx @deepseek-ai/dsh@latest` re-resolves on every start, so `restart` (or a
reboot) pulls the newest upstream release. Pin a version at the top of
`dsh-web.sh` (`DSH_VERSION_SPEC`) if you prefer stability.

## Configuration

The server reads `~/.dsh/settings.yaml` (providers/models) and
`~/.dsh/.credentials.yaml` (API keys). Both survive updates.

## How the native app works

`native/DSH.app` (Swift + WKWebView) runs `dsh-web.sh ensure`, which starts the
service if needed and prints the current token URL; the app loads it in a
native window with a proper menu bar (Cmd+Q, copy/paste). Closing the window
quits the app; the server keeps running in the background.
