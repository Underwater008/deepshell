# DeepShell

**A native macOS shell for the official [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).**
No Electron. No telemetry. No vendor gateway. ~150 lines of Swift + one bash script.

Deep**SH**ell — `dsh` — a seashell for the deep. The homage is the point: it says
exactly what it is.

## What it does

- Runs the **official** DeepSeek Harness (`@deepseek-ai/dsh` from npm — nothing
  forked, nothing patched) as a launchd service that starts at login and
  restarts on crash
- Hosts the official web UI in a **native WKWebView window** (menu bar, Cmd+Q,
  copy/paste) — a real Mac app, not a browser tab, not Chromium
- **Phone connect** from the menu bar: Wi-Fi (LAN) or internet (Cloudflare
  tunnel), with QR codes — the harness itself stays on 127.0.0.1, the way
  upstream intends
- Lets you use **any OpenAI-compatible provider** the engine supports (custom
  baseURL, `apiKeyEnv` credential refs, custom headers) — self-hosted vLLM,
  RunPod, Modal, Ollama, whatever you run
- Tracks upstream `@latest` on every restart (or pin a version)

## Why not DSH Desktop?

[DSH Desktop](https://github.com/dataelement/dsh-desktop) is a fine piece of
engineering by DataElement — and it is a **company product**, not a DeepSeek
product and not a community project. The differences that made us build this:

| | DeepShell | DSH Desktop |
|---|---|---|
| Engine | official `@deepseek-ai/dsh` | same official engine |
| Shell | Swift + WKWebView (native) | Electron (Chromium) |
| App footprint | ~1 MB | ~200 MB+ |
| Phones home | **never** — no crash reports, no analytics, no update pings | crash reports + update checks to vendor domain |
| Vendor agenda | none | enterprise gateway login (BiSheng) in the PR queue |
| Providers | anything the engine accepts (custom endpoints, headers, env-refs) | form-validated subset (rejects some valid endpoints, e.g. custom Modal deployments) |
| Phone connect | QR from the menu bar; LAN or tunnel | QR pairing + tunnel |
| Zero-terminal install | needs Node (npx) — bundled runtime on the roadmap | bundled runtime ✓ |
| Platforms | macOS | macOS / Windows / Linux |
| Naming | not affiliated with DeepSeek; says so | named "DSH Desktop"; not affiliated with DeepSeek |

If you need Windows/Linux today, or a fully zero-terminal installer, theirs is
honestly the better choice **right now**. If you want a native, inspectable,
no-agenda shell for your Mac — this is yours.

## Install

Requires macOS 12+ (Apple Silicon), Node (via nvm or Homebrew), and optionally
`qrencode` + `socat` + `cloudflared` for phone connect.

```bash
git clone https://github.com/Underwater008/deepshell.git
cd deepshell
./deepshell.sh install      # launchd service: starts at login, restarts on crash
./native/build.sh           # builds native/DeepShell.app
```

Drag `native/DeepShell.app` into your Dock. Configure providers/models in
`~/.dsh/settings.yaml` (upstream schema) — it survives updates.

## Usage

```bash
./deepshell.sh open         # open UI in browser (or click the Dock app)
./deepshell.sh status       # service state + current URL
./deepshell.sh restart      # also pulls the newest upstream release
./deepshell.sh lan          # phone on same Wi-Fi: QR in terminal
./deepshell.sh tunnel       # phone anywhere: Cloudflare quick tunnel + QR
./deepshell.sh local        # back to localhost-only
./deepshell.sh uninstall
```

The **Phone** menu in the app does the same things with a QR window.

### Security notes

- The harness binds **127.0.0.1 only** (upstream hard-refuses `0.0.0.0`).
  LAN mode adds a socat forwarder on your Wi-Fi IP; tunnel mode forwards via
  Cloudflare. Both are gated by the per-launch login token — treat a tokenized
  URL like a password.
- No analytics, no crash reporting, no update pings. The app makes exactly two
  kinds of network calls: localhost, and whatever the harness itself needs
  (npm registry on updates, your model providers).

## Roadmap

- [ ] App icon + notarized release builds (Apple Developer program)
- [ ] First-run guided setup (install Node/engine without Terminal)
- [ ] Sparkle auto-updates
- [ ] Provider preset gallery (RunPod, Modal, vLLM, Ollama, …)
- [ ] Windows/Linux only if the community actually wants it

## Legal

DeepSeek Harness is © DeepSeek AI, MIT licensed. DeepShell is an independent
community project — **not affiliated with, endorsed by, or sponsored by
DeepSeek**. "DeepShell" re-derives the `dsh` abbreviation as an open homage
(Deep**SH**ell), the way third-party clients have always named themselves.
MIT licensed; do whatever you want.
