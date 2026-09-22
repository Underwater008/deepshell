# DeepShell for Windows

A Windows installer for the official [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
web UI — no terminal, no Node install, no admin rights needed.

**Status: preview.** The upstream harness ships Windows support (PowerShell
shell tool, ACL sandbox); this installer packages it with a portable Node
runtime and a no-console launcher. The macOS extras (launchd service, native
WKWebView app, Tailscale phone connect) are not part of this preview — see
the roadmap at the bottom.

## Install

1. Download `DeepShell-Setup.exe` from the
   [Releases page](https://github.com/Underwater008/deepshell/releases) (the
   `win-v*` releases).
2. Run it. Windows SmartScreen may show "Windows protected your PC" because
   the installer is not code-signed: click **More info → Run anyway**. This
   is expected and harmless.
3. That's it. No wizard, no questions — one progress bar and DeepShell
   opens. It installs per-user to `%LOCALAPPDATA%\DeepShell`, puts itself in
   the Start Menu, and starts at sign-in (turn that off any time via
   Task Manager → Startup apps → DeepShell).

DeepShell installs to `%LOCALAPPDATA%\DeepShell` (per-user), starts the
harness hidden, and opens the web UI in its own **app-mode window** — no
tabs, no address bar, its own taskbar icon (via Edge, which ships with
Windows; Chrome works too, and anything else falls back to a normal browser
tab). It feels like a desktop app even though the UI is web. Clicking the
shortcut again while it's running just reopens the window.

**Stop** via Start Menu → DeepShell → *Stop DeepShell*. Closing the window
does not stop the harness (same as closing the window on macOS).
Uninstall from Settings → Apps as usual; stopping and cleanup are automatic.

## Provider setup (including Modal's two-header key)

Everything happens in the web UI or one YAML file — no terminal either way.

**Any OpenAI-compatible provider (RunPod, vLLM, Ollama, Moonshot, …):**
Settings → Models in the web UI, or edit `%USERPROFILE%\.dsh\settings.yaml`
directly (upstream schema; changes apply live).

**Modal** issues a Token ID / Token Secret *pair*, which a one-field key box
can't express. Two supported ways:

```yaml
# %USERPROFILE%\.dsh\settings.yaml
llm-pi-ai:
  providers:
    modal:
      api: openai-completions
      baseURL: https://<your-app>.modal.direct/v1
      apiKeyEnv: MODAL_API_KEY          # Option A: store the JOINED pair
      # headers:                        # Option B: native two-header auth
      #   Modal-Key: wk-your-token-id
      #   Modal-Secret: ws-your-token-secret
      models:
        - id: moonshotai/Kimi-K3
          name: Kimi-K3
          input: [text, image]
```

- **Option A** — Modal's documented escape hatch: join the pair with a period
  (`wk-….ws-…`). Paste it once in Settings → Models (or `setx MODAL_API_KEY
  "wk-….ws-…"` and sign out/in). It rides as an ordinary `Bearer` token.
- **Option B** — the upstream provider schema accepts arbitrary per-provider
  `headers:`, so `Modal-Key` + `Modal-Secret` go out exactly as Modal issued
  them. Don't set `apiKeyEnv` in this case.

## Differences from macOS DeepShell

- The agent's shell tool is **PowerShell (pwsh)**, not bash; the command
  sandbox uses Windows ACL restricted tokens instead of `sandbox-exec`. Both
  are upstream's Windows backends.
- No native app window (the browser tab is the UI), no menu bar / Cmd+Q.
- No phone connect (Tailscale Funnel), no SearXNG sidecar wiring yet. The
  search/video/mobile plugins are platform-neutral and will follow.
- State lives in `%USERPROFILE%\.dsh` and `%LOCALAPPDATA%\DeepShell` instead
  of `~/.dsh` and `~/Library/Application Support/deepshell`.

## Troubleshooting

- **The browser didn't open / the page won't load:** Start Menu → DeepShell
  once more (it reuses the running instance), then check the log at
  `%LOCALAPPDATA%\DeepShell\run\harness.log`.
- **Port 3080 already in use:** something else is bound to it; stop it or
  edit the port in `launcher.js` (search for `3080`).
- **Antivirus flags the installer:** unsigned installers occasionally trip
  heuristics. The build is reproducible from this repo (`windows/build.ps1`);
  the payload is the official Node.js zip plus `npm install @deepseek-ai/dsh`.

## Building it yourself

Requires Windows with [Inno Setup 6](https://jrsoftware.org/isinfo.php)
installed (or GitHub Actions — the `windows-release` workflow does the whole
thing, including the smoke test below):

```powershell
git clone https://github.com/Underwater008/deepshell.git
cd deepshell
powershell -ExecutionPolicy Bypass -File windows\build.ps1            # dist\DeepShell-Setup.exe
powershell -ExecutionPolicy Bypass -File windows\smoke-test.ps1       # install→launch→200→uninstall
```

`build.ps1 -DshVersion 0.1.5-rc.2` pins the bundled harness (default:
`latest`). The installer tracks the pinned version; upgrading means
installing a newer build — auto-update is on the roadmap.

## Roadmap (Windows)

- [x] Per-user installer, no-console launcher, Start Menu integration
- [x] CI build + install/launch/uninstall smoke test
- [ ] Code signing (kills the SmartScreen prompt)
- [ ] Auto-update
- [ ] WebView2 native window (parity with the macOS app)
- [ ] Phone connect (Tailscale Funnel on Windows), SearXNG sidecar wiring
