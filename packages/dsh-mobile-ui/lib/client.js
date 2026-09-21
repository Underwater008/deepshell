// Browser half of dsh-mobile-ui: a phone-first chrome for the harness web UI.
//
// Three jobs:
//
//   1. Stop the screen from moving when the keyboard opens (the big one).
//      iOS Safari still does not implement `interactive-widget=resizes-content`
//      (WebKit bug 259770): the layout viewport keeps its height, so a
//      height:100% app sticks its bottom-docked composer *behind* the
//      keyboard, and Safari pans/scrolls the page to reveal the focused
//      input — the whole screen jumps. We track window.visualViewport into
//      the --dsh-app-height / --dsh-app-offset-top custom properties, size
//      #root to the *visible* area, and counter-translate the pan, so the
//      composer simply docks above the keyboard like ChatGPT iOS. The meta
//      viewport is still upgraded (viewport-fit=cover, interactive-widget=
//      resizes-content) for Chromium, where the layout viewport does resize.
//      A 16px minimum on text inputs also kills iOS's focus auto-zoom, the
//      other source of "the screen moved while I typed".
//
//   2. Replace the desktop three-column frame with a single column plus an
//      off-canvas sidebar drawer (hamburger → slide in, backdrop tap or pick
//      a session → slide out), and a compact top bar (hamburger / session
//      title / new chat) registered into the root 'shell.overlay' slot.
//
//   3. Respect the notch: safe-area insets on the bar, the drawer, and the
//      composer seat.
//
// Selector strategy: stable hooks only. Slot outlets render as
// <div data-slot="...">, the frame carries [data-sidebar-collapsed] and owns
// the [data-shell-overlay] layer, and CSS-module classes are matched by their
// semantic suffix ([class*="sessionRow"]) so an upstream rebuild with fresh
// hash prefixes keeps working.
//
// The bundle is hand-written against the harness's client module system
// (window.__ModuleLoader__), so it ships without a build step.
window.__ModuleLoader__.load({
  id: 'dsh-mobile-ui',
  factory: function (require) {
    var module = { exports: {} }
    var React = require('react')
    var h = React.createElement
    var useEffect = React.useEffect
    var useState = React.useState

    /** Width at/below which the phone chrome takes over. */
    var MOBILE_QUERY = '(max-width: 768px)'
    var PRODUCT_TITLE = 'DeepSeek Harness'

    var CSS =
      '@media (max-width: 768px) {\n' +
      /* Lock the document: nothing outside the app's own scroll containers
         may move, so Safari has no page to pan when the keyboard opens. */
      '  html, body { overflow: hidden; overscroll-behavior: none; }\n' +
      '  body { position: fixed; inset: 0; width: 100%; }\n' +
      '  html { -webkit-text-size-adjust: 100%; }\n' +
      /* Size the app to the *visible* viewport and neutralize the iOS
         keyboard pan. The transform makes #root the containing block for
         fixed descendants, and since #root tracks the visual viewport
         exactly, fixed children stay correctly placed. */
      '  #root {\n' +
      '    height: var(--dsh-app-height, 100dvh) !important;\n' +
      '    transform: translate3d(0, var(--dsh-app-offset-top, 0px), 0);\n' +
      '  }\n' +
      '  :root { --dsh-mui-bar-h: calc(52px + env(safe-area-inset-top, 0px)); }\n' +
      /* The frame is the grid element that directly owns the shell overlay
         layer: collapse its three tracks into one. The inline
         grid-template-columns needs !important. */
      '  div:has(> [data-shell-overlay]) { grid-template-columns: minmax(0, 1fr) !important; }\n' +
      /* Center column (direct parent of the main outlet) stays in the single
         track, pushed below the mobile bar. */
      '  div:has(> [data-slot="main"]) {\n' +
      '    grid-area: 1 / 1;\n' +
      '    box-sizing: border-box;\n' +
      '    padding-top: var(--dsh-mui-bar-h);\n' +
      '  }\n' +
      /* The right column overlays the center instead of tracking. */
      '  [data-rightbar-col] { grid-area: 1 / 1; }\n' +
      /* Column drag handles are mouse-only. */
      '  div:has(> [data-shell-overlay]) > [class*="handle"],\n' +
      '  [data-slot="main.conversation"] [class*="widthHandle"] { display: none !important; }\n' +
      /* The grid child holding the sidebar outlet becomes an off-canvas
         drawer. */
      '  div:has(> [data-slot="sidebar"]) {\n' +
      '    position: fixed;\n' +
      '    top: 0; left: 0; bottom: 0;\n' +
      '    z-index: 80;\n' +
      '    width: min(320px, 85vw);\n' +
      '    transform: translate3d(-104%, 0, 0);\n' +
      '    transition: transform .28s cubic-bezier(.32, .72, 0, 1);\n' +
      '    box-shadow: 0 0 48px rgb(0 0 0 / .35);\n' +
      '  }\n' +
      '  div:has(> [data-shell-overlay]):not([data-sidebar-collapsed]) > div:has(> [data-slot="sidebar"]) {\n' +
      '    transform: translate3d(0, 0, 0);\n' +
      '  }\n' +
      /* The sidebar panel fills the drawer and clears the notch. Its inline
         width (from the desktop solve) needs !important. */
      '  [data-slot="sidebar"] > div {\n' +
      '    width: 100% !important;\n' +
      '    box-sizing: border-box;\n' +
      '    padding-top: env(safe-area-inset-top, 0px);\n' +
      '    padding-bottom: env(safe-area-inset-bottom, 0px);\n' +
      '  }\n' +
      /* Slimmer composer margins. */
      '  [data-slot="main.conversation"] > div { --dsh-composer-side-clearance: 6px; }\n' +
      /* Composer floats above the home indicator. */
      '  [data-slot="main.conversation"] [class*="composerSeat"] {\n' +
      '    padding-bottom: env(safe-area-inset-bottom, 0px);\n' +
      '  }\n' +
      /* The desktop title row (breadcrumbs + window actions) is replaced by
         the mobile bar; keep the view tabs when more than one view exists. */
      '  [data-slot="main.conversation"] [class*="titleRow"] { display: none; }\n' +
      '  [data-slot="main.conversation"] [class*="header"] {\n' +
      '    min-height: 0;\n' +
      '    padding: 4px 12px 0;\n' +
      '  }\n' +
      '  [data-slot="main.conversation"] [class*="tabs"] {\n' +
      '    gap: 20px;\n' +
      '    margin-top: 0;\n' +
      '    padding-left: 0;\n' +
      '    overflow-x: auto;\n' +
      '    scrollbar-width: none;\n' +
      '  }\n' +
      /* 16px minimum on text entry: iOS auto-zooms smaller inputs on focus,
         which is the other "screen moved while I typed" trigger. */
      '  [data-slot="conversation.composer.bar"] [contenteditable="true"],\n' +
      '  [class*="modalInput"],\n' +
      '  [class*="renameInput"] { font-size: 16px !important; }\n' +
      '}\n' +
      /* The mobile chrome itself: hidden on desktop, shown by the query. */
      '.dsh-mui-bar {\n' +
      '  position: fixed;\n' +
      '  top: 0; left: 0; right: 0;\n' +
      '  z-index: 30;\n' +
      '  display: none;\n' +
      '  align-items: center;\n' +
      '  height: var(--dsh-mui-bar-h, 52px);\n' +
      '  box-sizing: border-box;\n' +
      '  padding: env(safe-area-inset-top, 0px) 8px 0;\n' +
      '  background: color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 86%, transparent);\n' +
      '  -webkit-backdrop-filter: blur(18px) saturate(1.4);\n' +
      '  backdrop-filter: blur(18px) saturate(1.4);\n' +
      '  border-bottom: .5px solid var(--dsw-alias-border-l3, rgb(0 0 0 / .08));\n' +
      '  pointer-events: none !important; /* the overlay layer opts children back in */\n' +
      '  -webkit-tap-highlight-color: transparent;\n' +
      '}\n' +
      '@media (max-width: 768px) {\n' +
      '  .dsh-mui-bar { display: flex; }\n' +
      /* The backdrop is mobile-only chrome. Its rule stays inside this media
         block (like the drawer's) so no desktop state can ever dim the app —
         the component also renders it only under the query. */
      '  .dsh-mui-backdrop {\n' +
      '    position: fixed;\n' +
      '    inset: 0;\n' +
      '    z-index: 40;\n' +
      '    background: rgb(0 0 0 / .42);\n' +
      '    animation: dsh-mui-fade-in .22s ease-out;\n' +
      '  }\n' +
      '}\n' +
      '.dsh-mui-bar > * { pointer-events: auto; }\n' +
      '.dsh-mui-btn {\n' +
      '  appearance: none;\n' +
      '  font: inherit;\n' +
      '  border: 0;\n' +
      '  background: transparent;\n' +
      '  color: var(--dsw-alias-label-primary, currentColor);\n' +
      '  width: 40px;\n' +
      '  height: 40px;\n' +
      '  border-radius: 999px;\n' +
      '  display: grid;\n' +
      '  place-items: center;\n' +
      '  padding: 0;\n' +
      '  cursor: pointer;\n' +
      '  flex: none;\n' +
      '}\n' +
      '.dsh-mui-btn:active { background: var(--dsw-alias-interactive-bg-hover, rgb(128 128 128 / .18)); }\n' +
      '.dsh-mui-title {\n' +
      '  flex: 1;\n' +
      '  min-width: 0;\n' +
      '  padding: 0 4px;\n' +
      '  text-align: center;\n' +
      '  font-size: 15px;\n' +
      '  font-weight: 600;\n' +
      '  color: var(--dsw-alias-label-primary, currentColor);\n' +
      '  white-space: nowrap;\n' +
      '  overflow: hidden;\n' +
      '  text-overflow: ellipsis;\n' +
      '  pointer-events: none !important;\n' +
      '}\n' +
      '@keyframes dsh-mui-fade-in { from { opacity: 0; } to { opacity: 1; } }\n' +
      '@media (prefers-reduced-motion: reduce) {\n' +
      '  .dsh-mui-backdrop { animation: none; }\n' +
      '  div:has(> [data-slot="sidebar"]) { transition: none; }\n' +
      '}\n'

    // ---- stable DOM lookups -------------------------------------------------

    /** The AppFrame grid: parent of the shell overlay layer. */
    function frameElement() {
      var overlay = document.querySelector('[data-shell-overlay]')
      return overlay !== null ? overlay.parentElement : null
    }

    function drawerOpen() {
      var frame = frameElement()
      return frame !== null && !frame.hasAttribute('data-sidebar-collapsed')
    }

    function mobileMatches() {
      return typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_QUERY).matches
    }

    /** Live viewport match. The chrome renders nothing on desktop: the
        harness's own layout owns that experience, so interference is made
        structurally impossible rather than merely CSS-hidden. */
    function useMobile() {
      var pair = useState(mobileMatches)
      var mobile = pair[0]
      var setMobile = pair[1]
      useEffect(function () {
        if (typeof window.matchMedia !== 'function') return undefined
        var query = window.matchMedia(MOBILE_QUERY)
        var update = function () { setMobile(query.matches) }
        update()
        if (typeof query.addEventListener === 'function') {
          query.addEventListener('change', update)
          return function () { query.removeEventListener('change', update) }
        }
        return undefined
      }, [])
      return mobile
    }

    // ---- effect: viewport meta (Chromium keyboard resize, notch) -----------

    function patchViewportMeta() {
      var meta = document.querySelector('meta[name="viewport"]')
      var created = false
      if (meta === null) {
        meta = document.createElement('meta')
        meta.setAttribute('name', 'viewport')
        document.head.appendChild(meta)
        created = true
      }
      var original = meta.getAttribute('content') || ''
      var tokens = original.split(',').map(function (token) { return token.trim() }).filter(Boolean)
      for (var i = 0; i < ['viewport-fit=cover', 'interactive-widget=resizes-content'].length; i++) {
        var addition = ['viewport-fit=cover', 'interactive-widget=resizes-content'][i]
        var key = addition.split('=')[0]
        if (!tokens.some(function (token) { return token.split('=')[0] === key })) tokens.push(addition)
      }
      if (tokens.length > 0) meta.setAttribute('content', tokens.join(', '))
      return function () {
        if (created) meta.remove()
        else meta.setAttribute('content', original)
      }
    }

    // ---- effect: track the visible viewport into CSS custom properties -----

    function trackAppViewport() {
      var docEl = document.documentElement
      var vv = typeof window.visualViewport === 'object' ? window.visualViewport : null
      var raf = 0
      var timer = 0
      function write() {
        var height = vv !== null ? vv.height : window.innerHeight
        var offset = vv !== null ? vv.offsetTop : 0
        docEl.style.setProperty('--dsh-app-height', Math.round(height) + 'px')
        docEl.style.setProperty('--dsh-app-offset-top', Math.round(offset) + 'px')
      }
      function schedule() {
        if (raf !== 0) return
        raf = window.requestAnimationFrame(function () {
          raf = 0
          write()
        })
      }
      function scheduleOrientation() {
        schedule()
        // iOS reports stale geometry right at the orientation event.
        timer = window.setTimeout(write, 350)
      }
      write()
      if (vv !== null) {
        vv.addEventListener('resize', schedule)
        vv.addEventListener('scroll', schedule)
      }
      window.addEventListener('resize', schedule)
      window.addEventListener('orientationchange', scheduleOrientation)
      return function () {
        if (raf !== 0) window.cancelAnimationFrame(raf)
        if (timer !== 0) window.clearTimeout(timer)
        if (vv !== null) {
          vv.removeEventListener('resize', schedule)
          vv.removeEventListener('scroll', schedule)
        }
        window.removeEventListener('resize', schedule)
        window.removeEventListener('orientationchange', scheduleOrientation)
        docEl.style.removeProperty('--dsh-app-height')
        docEl.style.removeProperty('--dsh-app-offset-top')
      }
    }

    // ---- effect: stylesheet -------------------------------------------------

    function installStyles() {
      var tagId = 'dsh-mobile-ui/chrome'
      var existing = document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']')
      if (existing !== null) {
        existing.textContent = CSS
        return function () {}
      }
      var tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-mobile-ui'
      tag.dataset.pluginCss = tagId
      tag.textContent = CSS
      document.head.appendChild(tag)
      return function () {
        tag.remove()
      }
    }

    // ---- effect: dismiss the drawer on navigation taps ----------------------

    // ChatGPT-iOS behavior: picking a session, a search result, New chat, or
    // a global panel closes the drawer; text entry and per-row menus don't.
    function watchDrawerDismiss(layout) {
      function onClick(event) {
        if (!mobileMatches() || !drawerOpen()) return
        var target = event.target
        if (target === null || typeof target.closest !== 'function') return
        if (target.closest('input, textarea, [contenteditable="true"], [class*="rowActions"], [class*="menuOpen"]')) return
        if (target.closest('[class*="sessionRow"], [class*="searchResultRow"], [class*="newSession"], [class*="panelRow"]')) {
          layout.toggleSidebar()
        }
      }
      document.addEventListener('click', onClick)
      return function () {
        document.removeEventListener('click', onClick)
      }
    }

    // ---- the chrome: top bar + drawer backdrop ------------------------------

    function IconMenu() {
      return h('svg', { width: 20, height: 20, viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M3 6.5h14M3 13.5h9', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }),
      )
    }

    function IconCompose() {
      return h('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', {
          d: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7',
          stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        }),
        h('path', {
          d: 'M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z',
          stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        }),
      )
    }

    function selectSessionTitle(state) {
      if (state === null || typeof state !== 'object') return undefined
      var current = state.current
      if (current === undefined || current === null || state.byId === undefined) return undefined
      var session = state.byId[current]
      if (session === undefined || session === null) return undefined
      return typeof session.title === 'string' && session.title.length > 0 ? session.title : undefined
    }

    function selectActivePanel(info) {
      return info !== null && typeof info === 'object' && typeof info.activePanelId === 'string' ? info.activePanelId : null
    }

    /** Drawer-open state mirrored from the frame's data-sidebar-collapsed. */
    function useDrawerOpen() {
      var pair = useState(drawerOpen)
      var open = pair[0]
      var setOpen = pair[1]
      useEffect(function () {
        var frame = frameElement()
        if (frame === null) {
          setOpen(false)
          return undefined
        }
        var update = function () { setOpen(!frame.hasAttribute('data-sidebar-collapsed')) }
        update()
        if (typeof MutationObserver === 'function') {
          var observer = new MutationObserver(update)
          observer.observe(frame, { attributes: true, attributeFilter: ['data-sidebar-collapsed'] })
          return function () { observer.disconnect() }
        }
        var poll = window.setInterval(update, 700)
        return function () { window.clearInterval(poll) }
      }, [])
      return open
    }

    function MobileChrome(props) {
      var mobile = useMobile()
      var open = useDrawerOpen()
      var sessionTitle = typeof props.useSessions === 'function' ? props.useSessions(selectSessionTitle) : undefined
      var activePanel = typeof props.usePanelInfo === 'function' ? props.usePanelInfo(selectActivePanel) : null
      var title = activePanel !== null
        ? activePanel.charAt(0).toUpperCase() + activePanel.slice(1)
        : sessionTitle !== undefined
          ? sessionTitle
          : PRODUCT_TITLE
      // Desktop invariant: mount nothing. An expanded desktop sidebar reads as
      // "drawer open", so without this gate the backdrop dimmed the whole app
      // and swallowed every click into toggleSidebar().
      if (!mobile) return null
      return h(
        React.Fragment,
        null,
        open
          ? h('div', {
              className: 'dsh-mui-backdrop',
              'aria-hidden': 'true',
              onClick: function () { props.layout.toggleSidebar() },
            })
          : null,
        h(
          'div',
          { className: 'dsh-mui-bar', role: 'banner' },
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-mui-btn',
              'aria-label': open ? 'Close sidebar' : 'Open sidebar',
              'aria-expanded': open,
              onClick: function () { props.layout.toggleSidebar() },
            },
            h(IconMenu),
          ),
          h('div', { className: 'dsh-mui-title' }, title),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-mui-btn',
              'aria-label': 'New chat',
              onClick: function () { props.uiWorkspace.startSession() },
            },
            h(IconCompose),
          ),
        ),
      )
    }

    // ---- plugin -------------------------------------------------------------

    function apply(ctx) {
      ctx.effect(patchViewportMeta, 'mobile-ui: viewport meta')
      ctx.effect(trackAppViewport, 'mobile-ui: app viewport')
      ctx.effect(installStyles, 'mobile-ui: styles')
      var layout = ctx.get('layout')
      var uiWorkspace = ctx.get('uiWorkspace')
      ctx.effect(function () { return watchDrawerDismiss(layout) }, 'mobile-ui: drawer dismiss')
      ctx.slots.inject('shell.overlay', function () {
        return ctx.slots.register(
          { name: 'shell.overlay', id: 'mobile-ui.chrome', order: 100, label: 'Mobile chrome' },
          function MobileChromeEntry(props) {
            return h(MobileChrome, {
              useSessions: props.useSessions,
              usePanelInfo: props.usePanelInfo,
              layout: layout,
              uiWorkspace: uiWorkspace,
            })
          },
        )
      })
    }

    module.exports = { name: 'mobile-ui', inject: ['slots', 'layout', 'uiWorkspace'], apply: apply }
    return module.exports
  },
})
