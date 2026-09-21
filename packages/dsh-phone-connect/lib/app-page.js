// The Remote switchboard page: a self-contained mobile-first HTML document
// served at /api/phone-connect/app (behind the harness's normal cookie auth).
// No build step, no external resources — one string.
//
// Layout mirrors the machines-first pattern: a row of machine pills with
// live presence (online = harness serving, away = machine up but harness
// down, offline = tailnet-down, checking = probing), tap-through to each
// machine's own harness, and a pairing section with this machine's QR.

export const APP_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b0d10">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>DeepShell Remote</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
  body {
    background: #0b0d10; color: #e6e8eb;
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif;
    padding: calc(env(safe-area-inset-top) + 18px) 18px calc(env(safe-area-inset-bottom) + 24px);
    max-width: 640px; margin: 0 auto;
  }
  h1 { font-size: 22px; font-weight: 700; letter-spacing: .2px; }
  .sub { color: #8b939e; font-size: 13px; margin: 2px 0 18px; }
  .machines { display: flex; gap: 10px; overflow-x: auto; padding: 4px 2px 10px; scrollbar-width: none; }
  .machines::-webkit-scrollbar { display: none; }
  .pill {
    flex: 0 0 auto; display: flex; align-items: center; gap: 8px;
    background: #161a20; border: 1px solid rgba(255,255,255,.09); border-radius: 999px;
    padding: 10px 16px; color: #e6e8eb; font-size: 14px; font-weight: 600;
    cursor: pointer; user-select: none; max-width: 240px;
  }
  .pill:active { transform: scale(.97); }
  .pill .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pill.offline { opacity: .45; }
  .pill .badge { font-size: 10px; font-weight: 700; color: #8b939e; border: 1px solid rgba(255,255,255,.14); border-radius: 6px; padding: 1px 5px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex: 0 0 auto; }
  .dot.online { background: #3fb950; box-shadow: 0 0 6px rgba(63,185,80,.7); }
  .dot.away { background: #d29922; }
  .dot.offline { background: #6e7681; }
  .dot.checking { background: #6e7681; animation: pulse 1.1s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .25; } }
  .section { margin-top: 22px; background: #11151b; border: 1px solid rgba(255,255,255,.07); border-radius: 14px; padding: 16px; }
  .section h2 { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .8px; color: #8b939e; margin-bottom: 10px; }
  .section p { color: #aab2bc; font-size: 13.5px; }
  .section p + p { margin-top: 6px; }
  .qr { display: block; width: 200px; height: 200px; margin: 12px auto 4px; background: #fff; border-radius: 12px; padding: 10px; image-rendering: pixelated; }
  .mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; word-break: break-all; color: #e6e8eb; }
  .hidden { display: none; }
  .foot { margin-top: 20px; text-align: center; color: #5c636c; font-size: 12px; }
  .foot a { color: #8b939e; }
</style>
</head>
<body>
  <h1>Remote</h1>
  <p class="sub">Your DeepShell machines</p>

  <div class="machines" id="machines"><span class="sub">Looking for machines…</span></div>

  <div class="section" id="pairSection">
    <h2>Pair this phone</h2>
    <div id="pairBody"><p>Loading…</p></div>
  </div>

  <div class="section">
    <h2>Add a machine</h2>
    <p>Install DeepShell on another Mac, sign its Tailscale app into the same account, and enable permanent access on its Settings → Plugins → Phone connect card. It appears in the row above on its own.</p>
    <p>First time opening a machine on this phone? That machine shows its own pairing QR on its Phone connect card — scan once, then this page's pills take you straight in.</p>
  </div>

  <p class="foot">served by dsh-phone-connect · <a href="/">open this Mac's harness</a></p>

<script>
(function () {
  var machinesEl = document.getElementById('machines')
  var pairBody = document.getElementById('pairBody')
  var selfHost = null

  function pill(machine) {
    var el = document.createElement('div')
    el.className = 'pill' + (machine.presence === 'offline' ? ' offline' : '')
    var dot = document.createElement('span')
    dot.className = 'dot ' + machine.presence
    var name = document.createElement('span')
    name.className = 'name'
    name.textContent = machine.name
    el.appendChild(dot)
    el.appendChild(name)
    if (machine.self) {
      var badge = document.createElement('span')
      badge.className = 'badge'
      badge.textContent = 'THIS MAC'
      el.appendChild(badge)
    }
    el.addEventListener('click', function () {
      if (machine.presence === 'offline') return
      try { window.localStorage.setItem('deepshell.opened.' + machine.host, '1') } catch (e) {}
      window.location.href = machine.self ? '/' : 'https://' + machine.host + '/'
    })
    return el
  }

  function render(payload) {
    machinesEl.textContent = ''
    var machines = payload.machines || []
    if (payload.selfHost) {
      machines = [{ name: payload.selfHost.split('.')[0], host: payload.selfHost, presence: 'online', self: true }].concat(machines)
    }
    if (machines.length === 0) {
      var empty = document.createElement('span')
      empty.className = 'sub'
      empty.textContent = payload.tailscale === false ? 'Tailscale is not running on this Mac.' : 'No other machines on this tailnet yet.'
      machinesEl.appendChild(empty)
      return
    }
    machines.forEach(function (machine) { machinesEl.appendChild(pill(machine)) })
  }

  function renderPair(status) {
    pairBody.textContent = ''
    if (status && status.phoneUrl && status.qrDataUrl) {
      var img = document.createElement('img')
      img.className = 'qr'
      img.alt = 'Pairing QR code'
      img.src = status.qrDataUrl
      var url = document.createElement('p')
      url.className = 'mono'
      url.textContent = status.phoneUrl
      var hint = document.createElement('p')
      hint.textContent = 'Scan with this phone camera — the URL carries this launch\\'s login token, so treat it like a password. It rotates when the harness restarts; the machine address does not.'
      pairBody.appendChild(img)
      pairBody.appendChild(url)
      pairBody.appendChild(hint)
    } else {
      var off = document.createElement('p')
      off.textContent = 'Phone access is off on this Mac — enable it from Settings → Plugins → Phone connect first.'
      pairBody.appendChild(off)
    }
  }

  function refreshPeers() {
    fetch('/api/phone-connect/peers', { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (data) {
        if (!data || !data.ok) return
        selfHost = data.selfHost
        render(data)
      })
      .catch(function () {})
  }

  function refreshStatus() {
    fetch('/api/phone-connect', { headers: { accept: 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null })
      .then(function (data) { renderPair(data) })
      .catch(function () {})
  }

  refreshPeers()
  refreshStatus()
  setInterval(refreshPeers, 10000)
  setInterval(refreshStatus, 30000)
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { refreshPeers(); refreshStatus() }
  })
})()
</script>
</body>
</html>
`
