# DeepShell

**A native shell for the official [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — macOS app + Windows installer (preview).**
~150 lines of Swift + one bash script on the Mac; a zero-click installer on Windows.

[![⬇️ Download for Windows](https://img.shields.io/badge/%E2%AC%87%EF%B8%8F_Download_for_Windows-DeepShell--Setup.exe-2563eb?style=for-the-badge)](https://github.com/Underwater008/deepshell/releases/latest/download/DeepShell-Setup.exe)
[![windows-release](https://github.com/Underwater008/deepshell/actions/workflows/windows-release.yml/badge.svg)](https://github.com/Underwater008/deepshell/actions/workflows/windows-release.yml)

Deep**SH**ell — `dsh` — a seashell for the deep. The homage is the point: it says
exactly what it is.

## What it does

- Runs the **official** DeepSeek Harness (`@deepseek-ai/dsh` from npm, exactly
  as upstream ships it) as a launchd service that starts at login and
  restarts on crash
- Hosts the official web UI in a **native WKWebView window** (menu bar, Cmd+Q,
  copy/paste) — a real Mac app
- **Phone connect** from Settings or the menu bar: persistent browser access through Tailscale
  Funnel, with QR codes — the harness itself stays on 127.0.0.1, the way
  upstream intends
- **Phone-first web UI**: a mobile chrome for the harness page — off-canvas
  sidebar drawer, compact top bar, and the keyboard fix that stops iOS from
  jumping the screen while you type (`packages/dsh-mobile-ui`)
- Lets you use **any OpenAI-compatible provider** the engine supports (custom
  baseURL, `apiKeyEnv` credential refs, custom headers) — self-hosted vLLM,
  RunPod, Modal, Ollama, whatever you run
- **Keyless web search** for the agent via a self-hosted
  [SearXNG](https://github.com/searxng/searxng) sidecar — no DeepSeek or
  search-API key needed (`search/` + `packages/dsh-web-search-searxng`)
- **Video Q&A** for local clips: a `video_qa` tool plugin hands a video to
  video-capable Kimi models and returns the answer as text — summarize,
  transcribe, find a moment (`packages/dsh-video-qa-moonshot`)
- Tracks upstream `@latest` on every restart (or pin a version)

## Install

### Windows (preview)

**[⬇️ Download DeepShell-Setup.exe](https://github.com/Underwater008/deepshell/releases/latest/download/DeepShell-Setup.exe)**
— one exe, no terminal, no admin: the official harness plus a portable Node
runtime, installed per-user. Double-click → one progress bar → DeepShell
opens in its own app window. Setup details, including the Modal two-header
key, in [WINDOWS.md](WINDOWS.md). The macOS extras (native app, phone
connect) are not part of the Windows preview yet.

### macOS

Requires macOS 12+ (Apple Silicon), Node (via nvm or Homebrew), and
optionally `qrencode` plus the Tailscale macOS app for phone connect. No
iPhone app or purchased domain is needed.

```bash
git clone https://github.com/Underwater008/deepshell.git
cd deepshell
./deepshell.sh install      # launchd service: starts at login, restarts on crash
./native/build.sh           # builds native/DeepShell.app
```

Drag `native/DeepShell.app` into your Dock. Configure providers/models in
`~/.dsh/settings.yaml` (upstream schema) — it survives updates.

The app bundle currently requires the setup above on each Mac; copying the
`.app` alone does not install the harness service or phone-connect plugin.

## Usage

```bash
./deepshell.sh open         # open UI in browser (or click the Dock app)
./deepshell.sh status       # service state + current URL
./deepshell.sh restart      # also pulls the newest upstream release
./deepshell.sh tunnel       # permanent phone address + pairing QR
./deepshell.sh local        # back to localhost-only
./deepshell.sh phone install    # refresh the Settings card and restart the harness
./deepshell.sh mobile install   # phone-first UI: drawer + top bar + keyboard fix (no restart)
./deepshell.sh search install   # SearXNG sidecar + harness wiring, one idempotent command
./deepshell.sh search status    # health + live query test + wiring check (start|stop|restart|logs too)
./deepshell.sh uninstall
```

The **Phone** menu in the app does the same things with a QR window.

### Mobile UI (phone-first layout + keyboard fix)

`./deepshell.sh mobile install` wires `packages/dsh-mobile-ui` into the web
profile — a browser-only plugin that reshapes the harness page on screens up
to 768px, ChatGPT-iOS style:

- The left rail disappears. A compact top bar (blur, notch-aware) takes over:
  **hamburger** slides the sidebar in as an off-canvas drawer over a dimmed
  backdrop; the center shows the session title; **✎** starts a new chat.
  Picking a session, a search result, or New chat closes the drawer.
- **The screen no longer jumps when you type.** iOS Safari still ignores
  `interactive-widget=resizes-content` (WebKit bug 259770), so the plugin
  tracks `window.visualViewport` into CSS variables, sizes the app to the
  *visible* area, and counter-translates Safari's keyboard pan — the composer
  simply docks above the keyboard. Text inputs also get a 16px minimum so iOS
  stops auto-zooming on focus. (Chromium/Android gets the standard
  `interactive-widget=resizes-content` meta instead.)
- Composer margins slim down, drag handles disappear, and the home indicator /
  notch safe areas are respected.

It applies on the next page load — no harness restart, no approval prompt
(it's a trusted composition row, like the phone-connect card). Desktop
windows are untouched; narrow any browser window below 768px to preview it.
`./deepshell.sh mobile uninstall` removes the patch row (equally live) if an
upstream release ever ships its own mobile layout or you want stock behavior
back.

### Phone connect from the web UI (Settings card)

Phone access is also available on the **Settings → Plugins → Remote**
card (`packages/dsh-phone-connect`), installed automatically by `deepshell.sh install`:

```bash
./deepshell.sh phone install   # refresh an existing installation and restart
./deepshell.sh phone status    # check the wiring
```

Phone access uses **Tailscale Funnel on the Mac**; the iPhone uses Chrome,
Safari, or another compatible browser. Safari is not required.
Funnel supplies the HTTPS hostname, so you do not need to buy a domain.
Install the standalone [Tailscale Mac app](https://tailscale.com/download/mac),
sign in with your own account, and allow the macOS network extension. Enable HTTPS/Funnel for this
Mac in Tailscale when prompted, then choose **Enable permanent access** in
DeepShell. If the provider needs setup, the card explains the missing step.

Open the pairing link or scan the QR in your preferred browser once. After
signing in, bookmark the clean address in that same browser. Browser sessions
are separate, so switching from Safari to Chrome requires pairing Chrome too.
That address stays the same across DeepShell and Mac restarts as long
as the Tailscale device name and network remain the same. The pairing token
rotates on harness launch, but existing browser sessions survive restarts
(30 days by default). Expired or cleared browser sessions need a new scan.

The card distinguishes **Save this address** from **Pair a phone**. Its API
remains behind the harness session and Host/Origin checks. Saved connection
state lives under `~/Library/Application Support/deepshell/phone/`, outside
Git. The CLI, native menu, and Settings use the same connection implementation.

Each installation uses the Tailscale account currently signed in on that Mac
and gets that device's address. No developer account, shared authentication
key, or personal connection state is bundled with DeepShell. Other users must
complete setup with their own accounts; their connections do not run through
the developer's Mac or Tailscale account.

- Quitting DeepShell stops its services; reopening restores enabled remote
  access at the same address. Closing the window keeps the services running.
- At Mac login, launchd starts the harness. If Tailscale connects later,
  DeepShell retries the saved connection automatically.
- **Turn off** persists across restarts. DeepShell never enables a fresh
  permanent connection without an explicit action.
- The Mac must be awake and online. A reboot with FileVault may require local
  login before the apps can run; remote access cannot unlock the Mac at boot.
- The HTTPS listener is public, while DeepShell access still requires login.
  Keep pairing QR codes private. The app preserves unrelated Tailscale services.
- Funnel is available on all Tailscale plans and has bandwidth limits. The
  Personal plan is for non-commercial use; business use needs an appropriate
  plan. See [Funnel](https://tailscale.com/docs/features/tailscale-funnel) and
  [pricing](https://tailscale.com/pricing). No paid plan is selected by DeepShell.

Older Cloudflare quick tunnels remain visible until you turn them off or
successfully enable the permanent connection, allowing a controlled upgrade.

### What quit means (lifecycle)

DeepShell follows "close the viewer, not the work; quit means quit":

- **Closing the window** just hides the UI — the harness and your agent
  sessions keep running. Click the Dock icon to reopen; your web session is
  still there.
- **Quitting the app** (Cmd+Q / right-click Quit) stops everything:
  the launchd harness service, any phone forwarder, and the SearXNG search
  sidecar (`deepshell.sh stop-all`). Reopening restores the saved permanent
  connection as well as the harness and search sidecar.
- Prefer an always-on server? **Services → Keep Services Running After
  Quit** opts out, and the same menu shows live
  `Harness: running · Search: running` state plus a manual
  **Stop Services Now**.

### Web search (no API keys)

The harness's built-in `web_search` tool ships wired to DeepSeek's keyed
endpoint. DeepShell instead registers a tiny provider plugin
(`packages/dsh-web-search-searxng`) into the harness's `ctx.web` seam that
queries a local [SearXNG](https://github.com/searxng/searxng) instance — a
free metasearch engine aggregating 70+ public engines, no key, no tracking.

- `./deepshell.sh search install` starts SearXNG in Docker on
  `127.0.0.1:8890` **and wires the harness in the same command**: it installs
  the provider plugin into the web profile and adds the patch rows below.
  Idempotent — a fresh clone needs exactly this one command (plus a harness
  restart for the Settings card). DeepShell runs its **own** instance on a
  nonstandard port rather than adopting whatever already sits on 8888:
  owning the instance means owning the engine set and ranking. The seeded
  `settings.yml` enables `google`, `github`, and `mdn` over the upstream
  defaults — upstream ships `google` disabled, and the other mainstream
  engines (Brave/DDG) rate-limit busy IPs, which is how default installs
  end up returning empty results or doc-engine noise for news queries.
- The profile patch layer (`~/.dsh/profiles/web/cordis.patch.yml`) — written
  by `search install` when absent — points the `web` seam at the
  `searxng-local` provider and mounts the plugin row; it hot-reloads, no
  harness restart needed.
- `./deepshell.sh search status` is the "is it working?" check: container
  health, a live query test with a result count, and whether the harness
  wiring is present — no API key involved, so "configured" and "working"
  are the same thing here.
- Plugin row config: `baseURL` (any reachable SearXNG), optional `engines`
  (comma list, per-query override), `language`, `safeSearch`. Prefer
  instance-side engine config (`search/settings/settings.yml`) over the
  `engines` stopgap — a restricted set also skews result ranking.
- **Settings visibility:** the package ships a browser half, so
  Settings → Plugins shows a “Web search (SearXNG)” card with the live
  endpoint/engines/language/safeSearch values (read-only, reflecting the
  `web-search-searxng` settings section). Edit in `~/.dsh/settings.yaml` or
  the patch layer; changes apply live.

### Third-party models, full toolset

Point the stock setup at a model its catalog doesn't ship — say Kimi K3 — and
the model is assumed text-only: attaching an image is refused before the
request ever leaves your Mac. DeepShell configures providers in
`~/.dsh/settings.yaml` using the full upstream schema, where every model can
declare its real capabilities:

```yaml
providers:
  moonshot:
    baseURL: https://api.moonshot.ai/v1
    apiKeyEnv: MOONSHOT_API_KEY
    models:
      - id: kimi-k3
        input: [text, image]   # the one line the stock setup was missing
```

Kimi K3 itself already understands video, per
[Moonshot's docs](https://platform.kimi.ai/docs/guide/use-kimi-vision-model) —
the engine's modality seam today is text/image, so native video lands the
moment the upstream adapter adds it. Until then, the `video_qa` tool below
already answers questions about local clips.

### Video Q&A (tool-mediated, works today)

The engine's modality seam is text/image, so a video can't ride an attachment
yet — but the models can already see it. `packages/dsh-video-qa-moonshot`
registers a `video_qa` tool that hands a local video straight to the
OpenAI-compatible endpoint and returns the answer as tool text: summarize a
clip, transcribe speech, describe scenes, find a moment.

- Two transports, auto-detected from the row's `baseURL`: `moonshot-files`
  (upload via `POST /v1/files`, then reference `ms://<file-id>` — the
  documented flow for api.moonshot.ai) and `video-url` (inline base64 for
  vLLM-family servers). Row config: `baseURL`, `apiKeyEnv`, `model`,
  `transport`, `maxVideoMB`, `timeoutMs`.
- Verified live against a RunPod-hosted Kimi K3 via `video-url`. Video
  support is serving-side: a Modal vLLM deployment of the same weights
  answered `Kimi-K3 supports image input only` — the tool surfaces exactly
  that error, so you always know which side to fix.
- Keys resolve per call through the harness credential store (`apiKeyEnv`),
  the same chain the official providers use; no key material in config.
- Smoke-test any endpoint without the harness:
  `node packages/dsh-video-qa-moonshot/scripts/smoke-test.mjs --path clip.mp4`

### Provider auth past `Bearer` — why Modal "never works" in other shells

RunPod works everywhere because it follows the plain OpenAI convention: one
key, sent as `Authorization: Bearer <key>`.

Modal doesn't hand you one key. A Modal [Proxy Token](https://modal.com/docs/guide/webhook-proxy-auth)
is a Token ID / Token Secret **pair**, and Modal's native scheme sends them as
two headers — `Modal-Key` and `Modal-Secret`. A shell with a single "paste
your API key" field can only emit `Authorization: Bearer <one string>` — paste
the Token ID, the Token Secret, or the `Modal-Key: …` curl snippet, and every
request comes back 401. Modal documents an escape hatch (join the pair with a
period: `Bearer wk-….ws-…`), but nothing in a paste-one-key GUI tells you
that.

DeepShell writes provider config in the upstream schema, which supports
arbitrary `headers:` per route — send `Modal-Key` + `Modal-Secret` exactly as
Modal issued them, or keep the joined pair in an env var referenced with
`apiKeyEnv`. Either way, your Modal endpoint authenticates on the first try.

### Security notes

- The harness binds **127.0.0.1 only** (upstream hard-refuses `0.0.0.0`).
  Phone access forwards through Tailscale Funnel. A per-launch pairing token
  grants a browser session; treat the pairing URL like a password.
- No analytics, no crash reporting, no update pings. The app makes exactly two
  ordinary kinds of network calls: localhost and what the harness needs
  (npm registry on updates, your model providers). Enabling phone access also
  connects through Tailscale Funnel to relay the phone session.

## Roadmap

- [ ] App icon + notarized release builds (Apple Developer program)
- [ ] First-run guided setup (install Node/engine without Terminal)
- [ ] Sparkle auto-updates
- [ ] Provider preset gallery (RunPod, Modal, vLLM, Ollama, …)
- [x] Windows preview: zero-click installer + app-mode window (see [WINDOWS.md](WINDOWS.md))
- [ ] Windows: code signing (kills SmartScreen), MSIX/Store install, auto-update
- [ ] Linux only if the community actually wants it

## Legal

DeepSeek Harness is © DeepSeek AI, MIT licensed. DeepShell is an independent
community project — **not affiliated with, endorsed by, or sponsored by
DeepSeek**. "DeepShell" re-derives the `dsh` abbreviation as an open homage
(Deep**SH**ell), the way third-party clients have always named themselves.
MIT licensed; do whatever you want.
