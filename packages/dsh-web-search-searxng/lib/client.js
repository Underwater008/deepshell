// Browser half of dsh-web-search-searxng: a card on the harness's
// Settings > Plugins page that makes the SearXNG web-search provider
// visible — current endpoint, engines, language, safeSearch, which values
// the user overrode, and where to edit them.
//
// The bundle is hand-written against the harness's client module system
// (window.__ModuleLoader__), so it ships without a build step. The card is
// read-only: writes go through the profile patch layer or settings.yaml,
// which this card reflects live through the shared settings mirror.
window.__ModuleLoader__.load({
  id: 'dsh-web-search-searxng',
  factory: function (require) {
    var module = { exports: {} }
    var React = require('react')
    var h = React.createElement

    var NS = 'web-search-searxng'

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
      var row = state.row
      var value = (row && row.value) || {}
      var user = (row && row.user) || {}
      var engines = value.engines || 'instance defaults'
      var language = value.language || 'instance default'
      var safeSearch = value.safeSearch === undefined ? 'instance default' : String(value.safeSearch)
      return h('section', { style: styles.card }, [
        h('h3', { key: 't', style: styles.title }, 'Web search (SearXNG)'),
        h(
          'p',
          { key: 'd', style: styles.description },
          'Self-hosted metasearch provider (searxng-local) — the native web_search tool, no DeepSeek key needed.',
        ),
        state.loaded && !row
          ? h('p', { key: 'missing', style: styles.description }, 'Provider row not mounted — check the profile patch layer.')
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
