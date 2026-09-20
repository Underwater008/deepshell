# dsh-web-launcher

Run the **official DeepSeek Harness web UI** (`@deepseek-ai/dsh` from npm) as a
macOS "app": auto-starts at login via launchd, opens from the Dock, always with a
fresh login token.

No Electron, no third-party wrapper — just the upstream server plus ~100 lines of
shell.

## What's here

| File | Purpose |
|---|---|
| `dsh-web.sh` | The whole manager: start/stop/open/install. |
| `DSH Web.app` | Dock-friendly launcher (AppleScript). Drag it to your Dock. Click = start server if needed + open browser at the fresh token URL. |
| `run/dsh-web.log` | Server log (the launchd service writes here). |

## Setup

```bash
./dsh-web.sh install     # install + start the launchd service (label: local.dsh-web)
```

Then drag `DSH Web.app` into the Dock. Done — it starts at every login and
auto-restarts on crash.

## Daily use

```bash
./dsh-web.sh open        # start if needed, open the UI (same as the Dock icon)
./dsh-web.sh status      # is it up? prints the current token URL
./dsh-web.sh restart     # pick up a newly published @latest version
./dsh-web.sh uninstall   # remove the service entirely
```

## Updates

`npx @deepseek-ai/dsh@latest` re-resolves `latest` on every start, so
`./dsh-web.sh restart` (or a reboot) pulls the newest upstream release.
To pin a version instead, edit the top of `dsh-web.sh`:

```bash
DSH_VERSION_SPEC="@0.1.5-rc.2"
```

## Configuration

The server reads `~/.dsh/settings.yaml` (providers, models) and
`~/.dsh/.credentials.yaml` (API keys) — not this repo. Config survives every update.

## Notes

- Binds `127.0.0.1:3080` by default (edit `PORT` in `dsh-web.sh`).
- Every server (re)start mints a new login token; the launcher always reads the
  fresh URL from the log, which is why you should open via the app/script rather
  than a bookmark. A successful login also sets a 30-day cookie, so an installed
  PWA keeps working until the next restart.
- For phone access: Tailscale, or `cloudflared tunnel --url http://127.0.0.1:3080`
  and share the full tokenized URL via QR. The token URL *is* the credential —
  treat it like a password.
