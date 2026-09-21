// Browser half of dsh-web-search-searxng: a card on the harness's
// Settings > Plugins page that makes the SearXNG web-search provider
// visible — current endpoint, engines, language, safeSearch, which values
// the user overrode, and where to edit them.
//
// The bundle is hand-written against the harness's client module system
// (window.__ModuleLoader__), so it ships without a build step. The card is
// read-only: writes go through the profile patch layer or settings.yaml,
// which this card reflects live through the shared settings mirror.
//
// The chrome mirrors the built-in plugin cards (see
// @deepseek-ai/dsh-client-ui-settings-plugins): an <li> disclosure whose
// header toggles a body, collapsed by default, styled with the same
// --dsw-alias-* tokens so it sits indistinguishably in the card list.
window.__ModuleLoader__.load({
  id: 'dsh-web-search-searxng',
  factory: function (require) {
    var module = { exports: {} }
    var React = require('react')
    var h = React.createElement

    var NS = 'web-search-searxng'
    var TITLE = 'Web search (SearXNG)'

    // Minimal snapshot store matching the harness's useSyncExternalStore
    // contract (getSnapshot/subscribe), avoiding a client-graph dependency.
    function createStore(initial) {
      var snapshot = initial
      var listeners = new Set()
      return {
        getSnapshot: function () {
          return snapshot
        },
        subscribe: function (listener) {
          listeners.add(listener)
          return function () {
            listeners.delete(listener)
          }
        },
        set: function (next) {
          snapshot = next
          Array.from(listeners).forEach(function (listener) {
            listener()
          })
        },
      }
    }

    function SearxngCardController(ctx) {
      this.mirror = ctx.settingsScope.describe()
      this.store = createStore({ loaded: false, row: undefined })
      var self = this
      ctx.effect(function () {
        return self.mirror.subscribe(function () {
          self.publish()
        })
      }, 'web-search-searxng: settings mirror')
      this.mirror.ensure()
      this.publish()
    }
    SearxngCardController.prototype.publish = function () {
      var snap = this.mirror.getSnapshot()
      var namespaces = (snap.view && snap.view.namespaces) || []
      var row
      for (var i = 0; i < namespaces.length; i++) {
        if (namespaces[i].ns === NS) row = namespaces[i]
      }
      this.store.set({ loaded: snap.status !== 'idle' || snap.view !== undefined, row: row })
    }
    SearxngCardController.prototype.inject = function () {
      return { hooks: { searxngSearch: this.store } }
    }

    // Token-for-token port of the built-in PluginCard stylesheet
    // (dsh-client-ui-settings-plugins): card/cardOpen, header, headText,
    // name, description, chevron/chevronOpen, body. The hover and
    // focus-visible rules have no inline-style equivalent; the disclosure
    // still carries aria-expanded for assistive tech.
    var styles = {
      card: {
        border: '.5px solid var(--dsw-alias-border-l4, #333)',
        background: 'var(--dsw-alias-bg-layer-3, transparent)',
        borderRadius: '16px',
        listStyle: 'none',
        transition: 'border-color .16s, background .16s',
      },
      cardOpen: {
        background: 'var(--dsw-alias-bg-layer-2, transparent)',
        borderColor: 'var(--dsw-alias-label-dimmed, #888)',
      },
      header: {
        appearance: 'none',
        width: '100%',
        font: 'inherit',
        color: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        background: 'none',
        border: 0,
        borderRadius: '12px',
        alignItems: 'center',
        gap: '12px',
        padding: '14px 16px',
        display: 'flex',
      },
      headText: { flexDirection: 'column', flex: 1, gap: '4px', minWidth: 0, display: 'flex' },
      name: { color: 'var(--dsw-alias-label-primary, inherit)', fontSize: '15px', fontWeight: 600, lineHeight: 1.4 },
      description: { color: 'var(--dsw-alias-label-tertiary, inherit)', fontSize: '13px', lineHeight: 1.5 },
      chevron: { color: 'var(--dsw-alias-label-tertiary, inherit)', flex: 'none', transition: 'transform .16s', display: 'block' },
      chevronOpen: { transform: 'rotate(180deg)' },
      body: { borderTop: '.5px solid var(--dsw-alias-border-l2, #333)', margin: '0 16px', paddingBottom: '12px' },
      readOnly: { color: 'var(--dsw-alias-label-tertiary, inherit)', margin: '12px 0 0', fontSize: '12px', lineHeight: 1.5 },
      row: {
        display: 'flex',
        gap: '8px',
        fontSize: '13px',
        lineHeight: 1.6,
        padding: '6px 0',
        borderTop: '.5px solid var(--dsw-alias-border-l2, #333)',
      },
      label: { minWidth: '110px', opacity: 0.6 },
      value: { fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' },
      badge: {
        marginLeft: '6px',
        padding: '0 6px',
        fontSize: '11px',
        borderRadius: '6px',
        border: '.5px solid currentColor',
        opacity: 0.7,
      },
      hint: { margin: '8px 0 0', fontSize: '12px', opacity: 0.55 },
    }

    function assign(target) {
      for (var i = 1; i < arguments.length; i++) {
        var source = arguments[i]
        if (!source) continue
        for (var key in source) target[key] = source[key]
      }
      return target
    }

    // 14px outline chevron, matching IconChevronDownOutline14 in the
    // built-in card header without a client-graph dependency.
    function Chevron(props) {
      return h(
        'svg',
        { width: 14, height: 14, viewBox: '0 0 14 14', fill: 'none', 'aria-hidden': true, style: props.style },
        h('path', {
          d: 'M3.5 5.25 7 8.75l3.5-3.5',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    function Field(props) {
      return h('div', { style: styles.row }, [
        h('span', { key: 'l', style: styles.label }, props.label),
        h(
          'span',
          { key: 'v', style: styles.value },
          props.value,
          props.overridden ? h('span', { style: styles.badge }, 'override') : null,
        ),
      ])
    }

    function SearxngSearchCard(props) {
      var state = props.useSearxngSearch(function (s) {
        return s
      })
      var openState = React.useState(false)
      var open = openState[0]
      var setOpen = openState[1]

      var row = state.row
      var value = (row && row.value) || {}
      var user = (row && row.user) || {}
      var engines = value.engines || 'instance defaults'
      var language = value.language || 'instance default'
      var safeSearch = value.safeSearch === undefined ? 'instance default' : String(value.safeSearch)

      return h('li', { style: assign({}, styles.card, open && styles.cardOpen) }, [
        h(
          'button',
          {
            key: 'header',
            type: 'button',
            style: styles.header,
            'aria-expanded': open,
            'aria-label': (open ? 'Collapse' : 'Expand') + ': ' + TITLE,
            onClick: function () {
              setOpen(!open)
            },
          },
          [
            h('span', { key: 'text', style: styles.headText }, [
              h('span', { key: 'name', style: styles.name }, TITLE),
              h(
                'span',
                { key: 'desc', style: styles.description },
                'Self-hosted metasearch provider (searxng-local) — the native web_search tool, no DeepSeek key needed.',
              ),
            ]),
            h(Chevron, { key: 'chevron', style: assign({}, styles.chevron, open && styles.chevronOpen) }),
          ],
        ),
        open
          ? h('div', { key: 'body', style: styles.body }, [
              h('p', { key: 'ro', role: 'status', style: styles.readOnly }, 'Read-only — edit the file below; changes apply live.'),
              state.loaded && !row
                ? h('p', { key: 'missing', style: styles.readOnly }, 'Provider row not mounted — check the profile patch layer.')
                : null,
              h(Field, { key: 'f1', label: 'Endpoint', value: value.baseURL || 'http://127.0.0.1:8888', overridden: user.baseURL !== undefined }),
              h(Field, { key: 'f2', label: 'Engines', value: engines, overridden: user.engines !== undefined }),
              h(Field, { key: 'f3', label: 'Language', value: language, overridden: user.language !== undefined }),
              h(Field, { key: 'f4', label: 'Safe search', value: safeSearch, overridden: user.safeSearch !== undefined }),
              h(
                'p',
                { key: 'h', style: styles.hint },
                'Edit in ~/.dsh/settings.yaml (web-search-searxng section) or the profile patch layer; changes apply live.',
              ),
            ])
          : null,
      ])
    }

    var inject = ['slots', 'settingsScope']

    function apply(ctx) {
      var controller = new SearxngCardController(ctx)
      ctx.slots.inject('settings.plugin.item', function* () {
        yield ctx.slots.register(
          {
            name: 'settings.plugin.item',
            key: NS,
            inject: function () {
              return controller.inject()
            },
          },
          SearxngSearchCard,
        )
      })
    }

    module.exports = { name: 'web-search-searxng', inject: inject, apply: apply }
    return module.exports
  },
})
