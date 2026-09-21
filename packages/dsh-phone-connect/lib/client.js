// Browser half of dsh-phone-connect: an interactive card on the harness's
// Settings → Plugins page that drives the host half's /api/phone-connect
// route — enable phone access through Tailscale Funnel, or
// turn it off, with the QR code rendered right in the card.
//
// Applying a change restarts the harness (trusted hosts are a launch-time
// flag). The page keeps its signed session cookie across the restart and
// reconnects by itself; the card polls the route until the new launch
// answers — the launch token rotates, which is how the card tells the new
// process apart from the old one.
//
// The bundle is hand-written against the harness's client module system
// (window.__ModuleLoader__), so it ships without a build step.
window.__ModuleLoader__.load({
  id: 'dsh-phone-connect',
  factory: function (require) {
    var module = { exports: {} }
    var React = require('react')
    var h = React.createElement
    var useEffect = React.useEffect
    var useRef = React.useRef
    var useState = React.useState

    var API = '/api/phone-connect'
    var RESTART_TIMEOUT_MS = 120000

    async function apiStatus() {
      var response = await fetch(API, { headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error('GET ' + API + ' → HTTP ' + response.status)
      return response.json()
    }

    async function apiSetMode(mode) {
      var response = await fetch(API, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ mode: mode }),
      })
      var data = await response.json().catch(function () {
        return null
      })
      if (data === null) throw new Error('POST ' + API + ' → HTTP ' + response.status)
      return data
    }

    var styles = {
      card: {
        border: '.5px solid var(--dsw-alias-border-l2, #333)',
        borderRadius: '10px',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        maxWidth: '760px',
      },
      title: { margin: 0, fontSize: '15px', fontWeight: 600 },
      description: { margin: '0 0 8px', fontSize: '13px', opacity: 0.7 },
      row: {
        display: 'flex',
        gap: '8px',
        fontSize: '13px',
        lineHeight: 1.6,
        padding: '6px 0',
        borderTop: '.5px solid var(--dsw-alias-border-l2, #333)',
      },
      label: { minWidth: '110px', opacity: 0.6, flexShrink: 0 },
      value: { fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' },
      buttons: { display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '10px 0 4px' },
      button: {
        font: 'inherit',
        fontSize: '13px',
        padding: '5px 12px',
        borderRadius: '8px',
        border: '.5px solid var(--dsw-alias-border-l2, #555)',
        background: 'transparent',
        color: 'inherit',
        cursor: 'pointer',
      },
      buttonActive: { fontWeight: 600, borderWidth: '1.5px' },
      buttonDisabled: { opacity: 0.45, cursor: 'default' },
      banner: {
        margin: '8px 0 0',
        padding: '8px 10px',
        fontSize: '13px',
        borderRadius: '8px',
        border: '.5px solid var(--dsw-alias-border-l2, #333)',
        opacity: 0.85,
      },
      error: {
        margin: '8px 0 0',
        padding: '8px 10px',
        fontSize: '13px',
        borderRadius: '8px',
        border: '.5px solid #c00',
        color: '#e66',
        wordBreak: 'break-word',
      },
      qrWrap: {
        alignSelf: 'flex-start',
        margin: '10px 0 2px',
        padding: '10px',
        background: '#fff',
        borderRadius: '10px',
        lineHeight: 0,
      },
      qr: { width: '220px', height: '220px', imageRendering: 'pixelated' },
      hint: { margin: '8px 0 0', fontSize: '12px', opacity: 0.55 },
    }

    function modeLabel(mode, permanent) {
      if (permanent && permanent.enabled) return mode === 'tunnel' ? 'Permanent connection' : 'Reconnecting automatically'
      if (mode === 'tunnel') return 'Temporary connection'
      return 'Local only'
    }

    function Field(props) {
      return h('div', { style: styles.row }, [
        h('span', { key: 'l', style: styles.label }, props.label),
        h('span', { key: 'v', style: styles.value }, props.value),
      ])
    }

    function PhoneConnectCard() {
      var _snapshot = useState(null)
      var snapshot = _snapshot[0]
      var setSnapshot = _snapshot[1]
      var _phase = useState('loading')
      var phase = _phase[0]
      var setPhase = _phase[1]
      var _error = useState(null)
      var error = _error[0]
      var setError = _error[1]
      var _setupUrl = useState(null)
      var setupUrl = _setupUrl[0]
      var setSetupUrl = _setupUrl[1]

      // Restart bookkeeping lives in refs: it drives decisions, not rendering.
      var restartRef = useRef({ baseline: null, target: null, startedAt: 0, deadline: 0 })

      function load() {
        return apiStatus().then(
          function (data) {
            setSnapshot(data)
            setError(null)
            setPhase('ready')
            return data
          },
          function (failure) {
            setError(String(failure && failure.message ? failure.message : failure))
            setPhase('ready')
            return null
          },
        )
      }

      // First load.
      useEffect(function () {
        load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      // Quiet refresh while idle.
      useEffect(
        function () {
          if (phase !== 'ready') return undefined
          var timer = setInterval(function () {
            apiStatus().then(function (data) {
              if (data) setSnapshot(data)
            }, function () {})
          }, 15000)
          return function () {
            clearInterval(timer)
          }
        },
        [phase],
      )

      // After an action: the harness restarts. Poll until the NEW launch
      // answers — the token in localUrl rotates per launch, so a changed
      // localUrl is the restart signal. Disk state alone is not proof that
      // the running server trusts the new address yet.
      useEffect(
        function () {
          if (phase !== 'restarting') return undefined
          var timer = setInterval(function () {
            var ctx = restartRef.current
            apiStatus().then(
              function (data) {
                if (!data) return
                var restarted = data.localUrl && ctx.baseline && data.localUrl !== ctx.baseline
                if (restarted && data.mode === ctx.target) {
                  setSnapshot(data)
                  setError(null)
                  setPhase('ready')
                } else if (Date.now() > ctx.deadline) {
                  setError('timed out waiting for the harness to restart — check deepshell.sh status')
                  setPhase('ready')
                }
              },
              function () {
                if (Date.now() > restartRef.current.deadline) {
                  setError('timed out waiting for the harness to restart — check deepshell.sh status')
                  setPhase('ready')
                }
              },
            )
          }, 1000)
          return function () {
            clearInterval(timer)
          }
        },
        [phase],
      )

      function act(mode) {
        setPhase('posting')
        setError(null)
        setSetupUrl(null)
        apiSetMode(mode).then(
          function (data) {
            if (!data.ok) {
              setError(data.error || 'action failed')
              setSetupUrl(data.setupUrl || null)
              setPhase('ready')
              return
            }
            restartRef.current = {
              baseline: snapshot && snapshot.localUrl,
              target: mode,
              startedAt: Date.now(),
              deadline: Date.now() + RESTART_TIMEOUT_MS,
            }
            setPhase('restarting')
          },
          function (failure) {
            setError(String(failure && failure.message ? failure.message : failure))
            setPhase('ready')
          },
        )
      }

      var busy = phase !== 'ready'
      var mode = snapshot ? snapshot.mode : 'local'
      var managed = snapshot ? snapshot.managed : true
      var permanent = snapshot && snapshot.permanent

      function button(label, targetMode, opts) {
        opts = opts || {}
        var isActive = mode === targetMode && !opts.neverActive && (targetMode !== 'tunnel' || (permanent && permanent.enabled))
        var disabled = busy || !snapshot || !managed || isActive || (opts.disabledWhen && opts.disabledWhen())
        var style = Object.assign({}, styles.button, isActive ? styles.buttonActive : null, disabled ? styles.buttonDisabled : null)
        return h(
          'button',
          {
            key: targetMode + label,
            style: style,
            disabled: disabled,
            onClick: function () {
              if (!disabled) act(targetMode)
            },
          },
          (isActive ? '✓ ' : '') + label,
        )
      }

      var children = [
        h('h3', { key: 't', style: styles.title }, 'Phone connect (DeepShell)'),
        h(
          'p',
          { key: 'd', style: styles.description },
          'Use Chrome or Safari on your iPhone from anywhere. Pair once in your preferred browser, then bookmark the page. Your saved address reconnects after DeepShell restarts; keep the Mac awake and online.',
        ),
      ]

      if (snapshot && !managed) {
        children.push(
          h(
            'p',
            { key: 'unmanaged', style: styles.error },
            'This harness is not running under the DeepShell launchd service (' +
              snapshot.label +
              ') — run deepshell.sh install first.',
          ),
        )
      }

      if (snapshot === null) {
        children.push(h('p', { key: 'loading', style: styles.description }, phase === 'loading' ? 'Loading…' : 'Status unavailable.'))
      } else {
        children.push(h(Field, { key: 'mode', label: 'Mode', value: modeLabel(mode, permanent) }))
        if (snapshot.needsCleanup && !(permanent && permanent.enabled)) {
          children.push(
            h(Field, {
              key: 'stale',
              label: 'Warning',
              value: 'The previous temporary connection stopped. Set up permanent access below, or turn it off to clear the saved connection.',
            }),
          )
        }
        if (permanent && permanent.bookmarkUrl) {
          children.push(h(Field, { key: 'saved', label: 'Save this address', value: permanent.bookmarkUrl }))
        }
        if (snapshot.phoneUrl) {
          children.push(h(Field, { key: 'url', label: 'Pair a phone', value: snapshot.phoneUrl }))
        }
        if (snapshot.qrDataUrl) {
          children.push(
            h('div', { key: 'qr', style: styles.qrWrap }, h('img', { src: snapshot.qrDataUrl, alt: 'Phone connect QR code', style: styles.qr })),
          )
        }
      }

      children.push(
        h('div', { key: 'buttons', style: styles.buttons }, [
          button(permanent && permanent.enabled ? 'Remote access enabled' : 'Enable permanent access', 'tunnel', {
            disabledWhen: function () {
              return !permanent || !permanent.installed || !permanent.connected
            },
          }),
          button('Turn off', 'local', {
            neverActive: true,
            disabledWhen: function () {
              return mode === 'local' && !(snapshot && snapshot.needsCleanup) && !(permanent && permanent.enabled)
            },
          }),
        ]),
      )

      if (permanent && !permanent.installed) {
        children.push(h('p', { key: 'setup', style: styles.banner }, [
          'One-time Mac setup: install ',
          h('a', { key: 'link', href: 'https://tailscale.com/download/mac' }, 'Tailscale'),
          ' and sign in with your own account. Your iPhone only needs Chrome or Safari; you do not need to buy a domain.',
        ]))
      } else if (permanent && !permanent.connected) {
        children.push(h('p', { key: 'signin', style: styles.banner }, 'Open Tailscale on this Mac and sign in to finish setup.'))
      }
      if (permanent && permanent.error) {
        children.push(h('p', { key: 'provider-error', style: styles.error }, permanent.error))
      }
      if (snapshot && !snapshot.tools.qrencode) {
        children.push(h('p', { key: 'tools', style: styles.hint }, 'Install qrencode on the Mac to show a QR image. The pairing link also works.'))
      }

      if (phase === 'posting') {
        children.push(h('p', { key: 'posting', style: styles.banner }, 'Connecting your permanent address…'))
      }
      if (phase === 'restarting') {
        children.push(
          h(
            'p',
            { key: 'restarting', style: styles.banner },
            'Applied — the harness is restarting to trust the new address. Keep this page open; it reconnects on its own and the QR code appears here when it’s back.',
          ),
        )
      }
      if (error) {
        children.push(h('p', { key: 'err', style: styles.error }, error))
      }
      if (setupUrl) {
        children.push(h('p', { key: 'funnel-setup', style: styles.banner }, [
          h('a', { key: 'link', href: setupUrl }, 'Review Tailscale’s HTTPS and Funnel approval'),
          '. After approving, return here and choose Enable permanent access again.',
        ]))
      }

      children.push(
        h(
          'p',
          { key: 'h', style: styles.hint },
          'The pairing QR signs a phone in; keep it private. Bookmark the page after signing in. The address stays the same, but an expired or cleared browser login requires pairing again.',
        ),
      )

      if (snapshot && snapshot.phoneUrl) {
        children.push(
          h(
            'p',
            { key: 'remote', style: styles.hint },
            [
              'On the phone, open ',
              h('a', { key: 'remote-link', href: '/api/phone-connect/app' }, 'Remote'),
              ' — a mobile switchboard for every DeepShell machine on the tailnet.',
            ],
          ),
        )
      }

      return h('section', { style: styles.card }, children)
    }

    var inject = ['slots']

    function apply(ctx) {
      ctx.slots.inject('settings.plugin.item', function* () {
        yield ctx.slots.register(
          {
            name: 'settings.plugin.item',
            key: 'phone-connect',
          },
          PhoneConnectCard,
        )
      })
    }

    module.exports = { name: 'phone-connect', inject: inject, apply: apply }
    return module.exports
  },
})
