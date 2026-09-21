// Browser half of dsh-pinned-chats: replaces the sidebar browsing region
// (sidebar.workspaces, priority shadow at -10 — the shipped browser sits at
// the default 0, so lowest renders and the original returns whenever this
// plugin is removed or its entry abdicates on a crash).
//
// On top of the shipped browser's everyday shape (search, collapsible
// project groups, row menus, running/done/waiting dots, relative times) it
// adds pinning:
//
//   - a "Pinned" section of pinned chats above everything;
//   - pinned projects float to the top of the group list;
//   - hover pin toggles on chat rows and project headers, pin/unpin entries
//     in the ⋯ menus;
//   - pin state fetched/persisted through the host half's /api/pins routes
//     (durable storage domain on the Host, shared by every browser session).
//
// Deliberate simplifications versus the shipped browser: no drag reorder, no
// sub-agent sub-rows, and the search box filters titles, cwd paths, and
// project names only (no message-content search).
//
// The bundle is hand-written against the harness's client module system
// (window.__ModuleLoader__), so it ships without a build step.
window.__ModuleLoader__.load({
  id: 'dsh-pinned-chats',
  factory: function (require) {
    var module = { exports: {} }
    var React = require('react')
    var h = React.createElement
    var useState = React.useState
    var useEffect = React.useEffect
    var useMemo = React.useMemo
    var useRef = React.useRef

    var STYLE_TAG_ID = 'dsh-pinned-chats/chrome'
    var LIST_PATH = '/api/pins'
    var TOGGLE_PATH = '/api/pins/toggle'

    var CSS = [
      '.pinsb_root{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-size:14px}',
      '.pinsb_header{display:flex;align-items:center;justify-content:space-between;padding:8px 10px 4px}',
      '.pinsb_headerTitle{font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}',
      '.pinsb_headerActions{display:flex;align-items:center;gap:10px}',
      '.pinsb_iconBtn{cursor:pointer;width:16px;height:16px;color:var(--dsw-alias-label-tertiary);background:0 0;border:none;border-radius:4px;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}',
      '.pinsb_iconBtn:hover{color:var(--dsw-alias-label-primary)}',
      '.pinsb_search{padding:2px 8px 6px}',
      '.pinsb_searchInput{box-sizing:border-box;width:100%;background:var(--dsw-alias-button-elevated-fill);border:.5px solid var(--dsw-alias-border-l4);border-radius:6px;outline:none;color:inherit;padding:4px 8px;font-size:13px;line-height:18px}',
      '.pinsb_scroll{flex:1;min-height:0;overflow-y:auto;padding:0 6px 10px}',
      '.pinsb_notice{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:4px 2px 6px;padding:5px 8px;border-radius:6px;background:var(--dsw-alias-button-elevated-fill);border:.5px solid var(--dsw-alias-border-l4);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:16px}',
      '.pinsb_sectionLabel{display:flex;align-items:center;gap:6px;padding:10px 8px 2px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary)}',
      '.pinsb_sessionRow,.pinsb_projectRow{cursor:pointer;user-select:none;color:var(--dsw-alias-label-primary);border-radius:8px;align-items:center;gap:6px;padding:0 8px;display:flex;position:relative}',
      '.pinsb_sessionRow:hover,.pinsb_projectRow:hover,.pinsb_sessionRow.pinsb_selected,.pinsb_sessionRow.pinsb_menuOpen,.pinsb_projectRow.pinsb_menuOpen{background:var(--dsw-alias-interactive-bg-hover)}',
      '.pinsb_projectRow{box-sizing:border-box;height:34px}',
      '.pinsb_sessionRow{height:32px;gap:0}',
      '.pinsb_slot{width:16px;height:20px;color:var(--dsw-alias-label-tertiary);flex:none;justify-content:center;align-items:center;display:inline-flex;margin-right:4px}',
      '.pinsb_dot{width:7px;height:7px;border-radius:50%;display:inline-block}',
      '.pinsb_dotDone{background:var(--dsw-alias-state-business-primary,#3fb950)}',
      '.pinsb_dotPending{background:var(--dsw-alias-state-warning,#d29922)}',
      '.pinsb_matrix{color:var(--dsw-static-deepseek-450,#5686fe)}',
      '.pinsb_cell{fill:currentColor;opacity:.15;animation:pinsb_chase 1s infinite}',
      '@keyframes pinsb_chase{0%,12.4%{opacity:1}12.5%,24.9%{opacity:.6}25%,37.4%{opacity:.35}37.5%,to{opacity:.15}}',
      '.pinsb_title{text-overflow:ellipsis;white-space:nowrap;min-width:0;font-size:14px;line-height:20px;overflow:hidden;flex:1}',
      '.pinsb_sessionRow .pinsb_title{margin:0 6px 0 4px}',
      '.pinsb_titlePin{flex:none;color:var(--dsw-alias-label-tertiary);display:inline-flex;margin-left:2px}',
      '.pinsb_time{color:var(--dsw-alias-label-tertiary);flex:none;font-size:12px;line-height:20px}',
      '.pinsb_meta{text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px;overflow:hidden;flex:none;max-width:40%}',
      '.pinsb_count{color:var(--dsw-alias-label-tertiary);flex:none;font-size:12px;line-height:20px}',
      '.pinsb_rowActions{flex:none;align-items:center;gap:12px;display:none;margin-left:auto}',
      '.pinsb_projectRow:hover .pinsb_rowActions,.pinsb_sessionRow:hover .pinsb_rowActions,.pinsb_projectRow.pinsb_menuOpen .pinsb_rowActions,.pinsb_sessionRow.pinsb_menuOpen .pinsb_rowActions{display:inline-flex}',
      '.pinsb_sessionRow:hover .pinsb_time,.pinsb_sessionRow.pinsb_menuOpen .pinsb_time{display:none}',
      '.pinsb_projectRow:hover .pinsb_count,.pinsb_projectRow.pinsb_menuOpen .pinsb_count{display:none}',
      '.pinsb_arrow{transition:transform .15s var(--ds-ease-in-out,ease)}',
      '.pinsb_arrowOpen{transform:rotate(90deg)}',
      '.pinsb_renameInput{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-button-elevated-fill);min-width:0;flex:1;color:inherit;border-radius:4px;outline:none;padding:0 2px;font-size:14px;line-height:20px}',
      '.pinsb_backdrop{position:fixed;inset:0;z-index:60}',
      '.pinsb_menu{position:fixed;z-index:61;min-width:168px;padding:4px;border-radius:8px;background:var(--dsw-alias-button-elevated-fill,#24262b);border:.5px solid var(--dsw-alias-border-l4,rgba(127,127,127,.35));box-shadow:0 8px 24px rgba(0,0,0,.28)}',
      '.pinsb_menuItem{display:flex;align-items:center;gap:8px;padding:5px 10px;border-radius:6px;cursor:pointer;font-size:13px;line-height:18px;color:var(--dsw-alias-label-primary);white-space:nowrap}',
      '.pinsb_menuItem:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.pinsb_menuItem.pinsb_danger{color:var(--dsw-alias-state-danger,#e5534b)}',
      '.pinsb_empty{padding:12px 10px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:17px}',
      '.pinsb_rail{display:flex;flex-direction:column;align-items:center;gap:14px;padding-top:10px}',
      '.pinsb_railBtn{width:20px;height:20px}',
      '.pinsb_pinSvg{opacity:.85}',
      '@media (prefers-reduced-motion:reduce){.pinsb_cell{animation:none}.pinsb_arrow{transition:none}}',
    ].join('\n')

    function Icon(props) {
      var base = { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true }
      if (props.name === 'dots') {
        return h('svg', base,
          h('circle', { cx: 3.5, cy: 8, r: 1.4, fill: 'currentColor' }),
          h('circle', { cx: 8, cy: 8, r: 1.4, fill: 'currentColor' }),
          h('circle', { cx: 12.5, cy: 8, r: 1.4, fill: 'currentColor' }))
      }
      if (props.name === 'plus') {
        return h('svg', Object.assign({}, base, { stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
          h('line', { x1: 8, y1: 3, x2: 8, y2: 13 }),
          h('line', { x1: 3, y1: 8, x2: 13, y2: 8 }))
      }
      if (props.name === 'search') {
        return h('svg', Object.assign({}, base, { stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
          h('circle', { cx: 7, cy: 7, r: 4.2 }),
          h('line', { x1: 10.2, y1: 10.2, x2: 13.5, y2: 13.5 }))
      }
      if (props.name === 'chevron') {
        return h('svg', Object.assign({}, base, { stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', className: 'pinsb_arrow' + (props.open ? ' pinsb_arrowOpen' : '') }),
          h('polyline', { points: '6 3.5 10.5 8 6 12.5' }))
      }
      if (props.name === 'folder') {
        return h('svg', Object.assign({}, base, { stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' }),
          h('path', { d: 'M2.5 4.6a1.4 1.4 0 0 1 1.4-1.4h2.6l1.2 1.5h4.9a1.4 1.4 0 0 1 1.4 1.4v5.3a1.4 1.4 0 0 1-1.4 1.4H3.9a1.4 1.4 0 0 1-1.4-1.4z' }))
      }
      if (props.name === 'folderPlus') {
        return h('svg', Object.assign({}, base, { stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round', strokeLinecap: 'round' }),
          h('path', { d: 'M2.5 4.6a1.4 1.4 0 0 1 1.4-1.4h2.6l1.2 1.5h4.9a1.4 1.4 0 0 1 1.4 1.4v5.3a1.4 1.4 0 0 1-1.4 1.4H3.9a1.4 1.4 0 0 1-1.4-1.4z' }),
          h('line', { x1: 8, y1: 6.8, x2: 8, y2: 10.4 }),
          h('line', { x1: 6.2, y1: 8.6, x2: 9.8, y2: 8.6 }))
      }
      if (props.name === 'pin') {
        return h('svg', Object.assign({}, base, { className: 'pinsb_pinSvg' }),
          h('g', { transform: 'rotate(45 8 8)', fill: props.filled ? 'currentColor' : 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' },
            h('rect', { x: 5.4, y: 1.8, width: 5.2, height: 4.4, rx: 2.2 }),
            h('path', { d: 'M7.1 6.2 L8 14.2 L8.9 6.2 Z' })))
      }
      if (props.name === 'close') {
        return h('svg', Object.assign({}, base, { stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }),
          h('line', { x1: 4, y1: 4, x2: 12, y2: 12 }),
          h('line', { x1: 12, y1: 4, x2: 4, y2: 12 }))
      }
      return null
    }

    function relTime(ts) {
      if (!ts) return ''
      var diff = Math.max(0, Date.now() - ts)
      var m = Math.floor(diff / 60000)
      if (m < 1) return 'now'
      if (m < 60) return m + 'min'
      var hrs = Math.floor(m / 60)
      if (hrs < 24) return hrs + 'h'
      var d = Math.floor(hrs / 24)
      if (d < 30) return d + 'd'
      var mo = Math.floor(d / 30)
      if (mo < 12) return mo + 'mo'
      return Math.floor(mo / 12) + 'y'
    }

    function RenameInput(props) {
      var draftState = useState(props.initial || '')
      var draft = draftState[0]
      var setDraft = draftState[1]
      var submit = function () {
        var t = draft.trim()
        if (t === '' || t === props.initial) { props.onCancel(); return }
        props.onSubmit(t)
      }
      return h('input', {
        className: 'pinsb_renameInput',
        value: draft,
        autoFocus: true,
        spellCheck: false,
        onClick: function (e) { e.stopPropagation() },
        onChange: function (e) { setDraft(e.target.value) },
        onKeyDown: function (e) {
          if (e.key === 'Enter') submit()
          else if (e.key === 'Escape') props.onCancel()
        },
        onBlur: submit,
      })
    }

    function apply(ctx) {
      var slots = ctx.get('slots')
      if (slots === undefined) return
      var sessionsSvc = ctx.get('sessions')
      var uiWorkspace = ctx.get('uiWorkspace')
      var workspacesSvc = ctx.get('workspaces')
      var noticeTimer = 0

      ctx.effect(function installStyles() {
        // Tagged with data-plugin/data-plugin-css so client-modules' HMR
        // bookkeeping attributes the tag to this package instead of claiming
        // an untagged <style> for the next materializing module.
        var existing = document.querySelector('style[data-plugin-css=' + JSON.stringify(STYLE_TAG_ID) + ']')
        if (existing !== null) {
          existing.textContent = CSS
          return function () {}
        }
        var tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-pinned-chats'
        tag.dataset.pluginCss = STYLE_TAG_ID
        tag.textContent = CSS
        document.head.appendChild(tag)
        return function () { tag.remove() }
      }, 'pinned-chats: styles')

      ctx.effect(function () {
        return function () { window.clearTimeout(noticeTimer) }
      }, 'pinned-chats: notice timer')

      function apiList() {
        return window.fetch(LIST_PATH).then(function (r) {
          if (!r.ok) throw new Error('pins route answered ' + r.status)
          return r.json()
        })
      }
      function apiToggle(kind, id) {
        return window.fetch(TOGGLE_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind: kind, id: id }),
        }).then(function (r) {
          if (!r.ok) throw new Error('pins route answered ' + r.status)
          return r.json()
        })
      }

      var svc = {
        openSession: function (id) {
          if (!uiWorkspace) throw new Error('navigation is unavailable')
          uiWorkspace.openSession(id)
        },
        startSession: function (workspaceId) {
          if (!uiWorkspace) throw new Error('session creation is unavailable')
          uiWorkspace.startSession(workspaceId)
        },
        forkSession: function (id) {
          if (!uiWorkspace) throw new Error('fork is unavailable')
          return uiWorkspace.forkSession(id)
        },
        archiveSession: function (id) {
          if (!uiWorkspace) throw new Error('archive is unavailable')
          return uiWorkspace.archiveSession(id)
        },
        renameSession: function (id, title) {
          if (!sessionsSvc || typeof sessionsSvc.binding !== 'function') return Promise.reject(new Error('rename is unavailable'))
          var binding = sessionsSvc.binding(id)
          if (!binding || !binding.session || typeof binding.session.rename !== 'function') return Promise.reject(new Error('session is not available yet'))
          return binding.session.rename(title).then(function (result) {
            if (!result || result.ok !== true) throw new Error(result && result.error && result.error.message ? result.error.message : 'rename failed')
          })
        },
        renameWorkspace: function (id, title) {
          if (!workspacesSvc) return Promise.reject(new Error('rename is unavailable'))
          return workspacesSvc.rename(id, title)
        },
        deleteWorkspace: function (id) {
          if (!workspacesSvc) return Promise.reject(new Error('delete is unavailable'))
          return workspacesSvc.delete(id)
        },
        addWorkspace: function () {
          if (!uiWorkspace || !workspacesSvc) return Promise.reject(new Error('workspace actions are unavailable'))
          return uiWorkspace.pickDirectory().then(function (path) {
            if (!path) return
            return workspacesSvc.create({ path: path })
          })
        },
      }

      var RUN_MATRIX_CELLS = [[0, 0], [4, 0], [8, 0], [8, 4], [8, 8], [4, 8], [0, 8], [0, 4]]

      // Running indicator: the upstream cube-loop chase (eight 2px squares
      // lighting up in sequence once per second), same as the shipped browser.
      function RunMatrix() {
        return h('svg', { className: 'pinsb_matrix', width: 10, height: 10, viewBox: '0 0 10 10', shapeRendering: 'crispEdges', 'aria-hidden': true },
          RUN_MATRIX_CELLS.map(function (c, i) {
            return h('rect', { key: c[0] + '-' + c[1], className: 'pinsb_cell', x: c[0], y: c[1], width: 2, height: 2, style: { animationDelay: ((i - RUN_MATRIX_CELLS.length) * 125) + 'ms' } })
          }))
      }

      function StatusDot(props) {
        if (props.pendingKind) return h('span', { className: 'pinsb_slot', title: 'Waiting for you: ' + props.pendingKind }, h('span', { className: 'pinsb_dot pinsb_dotPending' }))
        if (props.running) return h('span', { className: 'pinsb_slot', title: 'Running' }, h(RunMatrix))
        if (props.completed) return h('span', { className: 'pinsb_slot', title: 'Finished' }, h('span', { className: 'pinsb_dot pinsb_dotDone' }))
        return h('span', { className: 'pinsb_slot' })
      }

      function SessionRow(props) {
        var s = props.s
        var title = s.blank ? 'New Session' : (s.title || s.displayTitle || String(s.id))
        var rowClass = 'pinsb_sessionRow' + (props.selected ? ' pinsb_selected' : '') + (props.menuOpen ? ' pinsb_menuOpen' : '')
        return h('div', {
          className: rowClass,
          onClick: function () { props.onOpen(s.id) },
        },
          h(StatusDot, { pendingKind: props.pendingKind, running: s.running, completed: s.completed === true }),
          props.renaming
            ? h(RenameInput, {
                initial: s.blank ? '' : title,
                onSubmit: function (t) { props.onRenameSubmit(t) },
                onCancel: function () { props.onRenameCancel() },
              })
            : h('span', { className: 'pinsb_title', title: title }, title),
          props.pinned && !props.renaming ? h('span', { className: 'pinsb_titlePin', title: 'Pinned' }, h(Icon, { name: 'pin', filled: true })) : null,
          props.meta ? h('span', { className: 'pinsb_meta' }, props.meta) : null,
          !props.renaming ? h('span', { className: 'pinsb_time' }, relTime(s.updatedAt)) : null,
          h('span', { className: 'pinsb_rowActions' },
            h('button', {
              className: 'pinsb_iconBtn',
              title: props.pinned ? 'Unpin chat' : 'Pin chat',
              onClick: function (e) { e.stopPropagation(); props.onTogglePin('session', s.id) },
            }, h(Icon, { name: 'pin', filled: props.pinned })),
            h('button', {
              className: 'pinsb_iconBtn',
              title: 'More actions',
              onClick: function (e) { e.stopPropagation(); props.onMenu(e, 'session', s.id) },
            }, h(Icon, { name: 'dots' }))))
      }

      function GroupHeader(props) {
        var rowClass = 'pinsb_projectRow' + (props.menuOpen ? ' pinsb_menuOpen' : '')
        return h('div', { className: rowClass, onClick: function () { props.onToggleCollapse() } },
          h('span', { className: 'pinsb_slot', style: { marginRight: 0 } }, h(Icon, { name: 'chevron', open: !props.collapsed })),
          h(Icon, { name: 'folder' }),
          props.renaming
            ? h(RenameInput, {
                initial: props.label,
                onSubmit: function (t) { props.onRenameSubmit(t) },
                onCancel: function () { props.onRenameCancel() },
              })
            : h('span', { className: 'pinsb_title', title: props.subtitle || props.label }, props.label),
          props.pinned ? h('span', { className: 'pinsb_titlePin', title: 'Pinned' }, h(Icon, { name: 'pin', filled: true })) : null,
          h('span', { className: 'pinsb_count' }, String(props.count)),
          h('span', { className: 'pinsb_rowActions' },
            h('button', {
              className: 'pinsb_iconBtn',
              title: props.pinned ? 'Unpin project' : 'Pin project',
              onClick: function (e) { e.stopPropagation(); props.onTogglePin('workspace', props.workspaceId) },
            }, h(Icon, { name: 'pin', filled: props.pinned })),
            h('button', {
              className: 'pinsb_iconBtn',
              title: 'New chat here',
              onClick: function (e) { e.stopPropagation(); props.onNewChat(props.workspaceId) },
            }, h(Icon, { name: 'plus' })),
            h('button', {
              className: 'pinsb_iconBtn',
              title: 'More actions',
              onClick: function (e) { e.stopPropagation(); props.onMenu(e, 'workspace', props.workspaceId) },
            }, h(Icon, { name: 'dots' }))))
      }

      function Menu(props) {
        return h(React.Fragment, null,
          h('div', { className: 'pinsb_backdrop', onClick: props.onClose, onContextMenu: function (e) { e.preventDefault(); props.onClose() } }),
          h('div', {
            className: 'pinsb_menu',
            style: { left: props.menu.x + 'px', top: props.menu.y + 'px', transform: props.menu.up ? 'translateY(-100%)' : 'none' },
          },
            props.items.map(function (item) {
              return h('div', {
                key: item.id,
                className: 'pinsb_menuItem' + (item.danger ? ' pinsb_danger' : ''),
                onClick: function (e) { e.stopPropagation(); item.onPick() },
              }, item.label)
            })))
      }

      function Browser(props) {
        var wide = props.wide
        var expandSidebar = props.expandSidebar
        var useSessions = props.useSessions
        var useWorkspaces = props.useWorkspaces
        var usePending = props.useSessionPendingInteraction

        var sessionIds = useSessions(function (s) { return s.ids })
        var byId = useSessions(function (s) { return s.byId })
        var current = useSessions(function (s) { return s.current })
        var sessionsPhase = useSessions(function (s) { return s.phase })
        var wsItems = useWorkspaces(function (s) { return s.items })
        var wsPhase = useWorkspaces(function (s) { return s.phase })
        var archivedIds = useWorkspaces(function (s) { return s.archivedSessionIds })
        var pendingMap = usePending(function (m) { return m })

        var pinsState = useState({ sessions: {}, workspaces: {} })
        var pins = pinsState[0]
        var setPins = pinsState[1]
        var queryState = useState('')
        var query = queryState[0]
        var setQuery = queryState[1]
        var searchOpenState = useState(false)
        var searchOpen = searchOpenState[0]
        var setSearchOpen = searchOpenState[1]
        var collapsedState = useState({})
        var collapsed = collapsedState[0]
        var setCollapsed = collapsedState[1]
        var menuState = useState(null)
        var menu = menuState[0]
        var setMenu = menuState[1]
        var renamingState = useState(null)
        var renaming = renamingState[0]
        var setRenaming = renamingState[1]
        var confirmDeleteState = useState(null)
        var confirmDelete = confirmDeleteState[0]
        var setConfirmDelete = confirmDeleteState[1]
        var noticeState = useState(null)
        var notice = noticeState[0]
        var setNotice = noticeState[1]
        var rootRef = useRef(null)

        useEffect(function () {
          var alive = true
          apiList().then(function (state) { if (alive && state) setPins(state) }).catch(function () {})
          return function () { alive = false }
        }, [])

        var notify = function (message) {
          setNotice(String(message))
          window.clearTimeout(noticeTimer)
          noticeTimer = window.setTimeout(function () { setNotice(null) }, 5000)
        }
        var togglePin = function (kind, id) {
          apiToggle(kind, id).then(function (state) { if (state) setPins(state) }).catch(function (e) { notify('pin failed: ' + (e && e.message ? e.message : e)) })
        }
        var openMenu = function (e, kind, id) {
          var rect = rootRef.current ? rootRef.current.getBoundingClientRect() : null
          var up = rect ? e.clientY > rect.bottom - 210 : false
          setConfirmDelete(null)
          setMenu({ kind: kind, id: id, x: Math.max(4, e.clientX - 150), y: e.clientY, up: up })
        }
        var runRename = function (kind, id, title) {
          var p = kind === 'session' ? svc.renameSession(id, title) : svc.renameWorkspace(id, title)
          p.then(function () { setRenaming(null) }).catch(function (e) { setRenaming(null); notify(e && e.message ? e.message : e) })
        }

        var model = useMemo(function () {
          var archived = new Set(archivedIds || [])
          var ownedBy = new Map()
          ;(wsItems || []).forEach(function (w) { w.sessionIds.forEach(function (id) { ownedBy.set(id, w.workspaceId) }) })
          var wsById = new Map()
          ;(wsItems || []).forEach(function (w) { wsById.set(w.workspaceId, w) })
          var visible = []
          ;(sessionIds || []).forEach(function (id) {
            var s = byId[id]
            if (!s) return
            if (archived.has(id)) return
            if (s.origin === 'subagent') return
            if (s.blank === true && id !== current) return
            visible.push(s)
          })
          var visibleIds = new Set(visible.map(function (s) { return s.id }))
          var pinS = pins.sessions || {}
          var pinW = pins.workspaces || {}
          var pinnedSessions = visible
            .filter(function (s) { return pinS[s.id] !== undefined })
            .sort(function (a, b) { return pinS[a.id] - pinS[b.id] })
          var groups = (wsItems || []).map(function (w) {
            return {
              key: w.workspaceId,
              workspace: w,
              pinnedAt: pinW[w.workspaceId],
              sessions: w.sessionIds
                .filter(function (id) { return visibleIds.has(id) && pinS[id] === undefined })
                .map(function (id) { return byId[id] }),
            }
          })
          groups.sort(function (a, b) {
            var ap = a.pinnedAt === undefined ? Number.MAX_SAFE_INTEGER : a.pinnedAt
            var bp = b.pinnedAt === undefined ? Number.MAX_SAFE_INTEGER : b.pinnedAt
            return ap - bp
          })
          var ungrouped = visible
            .filter(function (s) { return !ownedBy.has(s.id) && pinS[s.id] === undefined })
            .sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0) })
          return { ownedBy: ownedBy, wsById: wsById, visible: visible, pinnedSessions: pinnedSessions, groups: groups, ungrouped: ungrouped, pinS: pinS, pinW: pinW }
        }, [sessionIds, byId, current, wsItems, archivedIds, pins])

        var q = query.trim().toLowerCase()
        var results = useMemo(function () {
          if (q === '') return []
          return model.visible.filter(function (s) {
            var title = (s.title || s.displayTitle || '').toLowerCase()
            if (title.indexOf(q) !== -1) return true
            if ((s.cwd || '').toLowerCase().indexOf(q) !== -1) return true
            var ws = model.wsById.get(model.ownedBy.get(s.id))
            if (ws && ws.title.toLowerCase().indexOf(q) !== -1) return true
            if (ws && ws.path.toLowerCase().indexOf(q) !== -1) return true
            return false
          })
        }, [q, model])

        if (!wide) {
          return h('div', { className: 'pinsb_rail', ref: rootRef },
            h('button', { className: 'pinsb_iconBtn pinsb_railBtn', title: 'Expand sidebar', onClick: function () { if (expandSidebar) expandSidebar() } }, h(Icon, { name: 'chevron' })),
            h('button', { className: 'pinsb_iconBtn pinsb_railBtn', title: 'New chat', onClick: function () { try { svc.startSession(undefined) } catch (e) { notify(e.message) } } }, h(Icon, { name: 'plus' })))
        }

        var renderRow = function (s, pinned, meta) {
          return h(SessionRow, {
            key: String(s.id),
            s: s,
            selected: s.id === current,
            pinned: pinned,
            meta: meta,
            pendingKind: pendingMap && pendingMap.get(s.id) ? pendingMap.get(s.id).kind : undefined,
            menuOpen: menu !== null && menu.kind === 'session' && menu.id === s.id,
            renaming: renaming !== null && renaming.kind === 'session' && renaming.id === s.id,
            onOpen: function (id) { try { svc.openSession(id) } catch (e) { notify(e.message) } },
            onTogglePin: togglePin,
            onMenu: openMenu,
            onRenameSubmit: function (t) { runRename('session', s.id, t) },
            onRenameCancel: function () { setRenaming(null) },
          })
        }

        var sections = []
        if (q !== '') {
          sections.push(h('div', { key: 'results', className: 'pinsb_sectionLabel' },
            'Results', h('span', { className: 'pinsb_count' }, String(results.length))))
          if (results.length === 0) sections.push(h('div', { key: 'no-match', className: 'pinsb_empty' }, 'No chats match "' + query.trim() + '".'))
          results.forEach(function (s) {
            var ws = model.wsById.get(model.ownedBy.get(s.id))
            sections.push(renderRow(s, model.pinS[s.id] !== undefined, ws ? ws.title : 'Ungrouped'))
          })
        } else {
          if (model.pinnedSessions.length > 0) {
            sections.push(h('div', { key: 'pinned-label', className: 'pinsb_sectionLabel' }, 'Pinned'))
            model.pinnedSessions.forEach(function (s) { sections.push(renderRow(s, true, null)) })
          }
          model.groups.forEach(function (g) {
            var isCollapsed = collapsed[g.key] === true
            var groupChildren = [h(GroupHeader, {
              key: 'h',
              workspaceId: g.key,
              label: g.workspace.title,
              subtitle: g.workspace.path,
              count: g.sessions.length,
              pinned: g.pinnedAt !== undefined,
              collapsed: isCollapsed,
              menuOpen: menu !== null && menu.kind === 'workspace' && menu.id === g.key,
              renaming: renaming !== null && renaming.kind === 'workspace' && renaming.id === g.key,
              onToggleCollapse: function () { setCollapsed(function (c) { return Object.assign({}, c, { [g.key]: !isCollapsed }) }) },
              onTogglePin: togglePin,
              onNewChat: function (wid) { try { svc.startSession(wid) } catch (e) { notify(e.message) } },
              onMenu: openMenu,
              onRenameSubmit: function (t) { runRename('workspace', g.key, t) },
              onRenameCancel: function () { setRenaming(null) },
            })]
            if (!isCollapsed) g.sessions.forEach(function (s) { groupChildren.push(renderRow(s, false, null)) })
            sections.push(h('div', { key: g.key }, groupChildren))
          })
          if (model.ungrouped.length > 0) {
            var ungCollapsed = collapsed.__ungrouped === true
            sections.push(h('div', { key: 'ungrouped-label', className: 'pinsb_sectionLabel', style: { cursor: 'pointer' }, onClick: function () { setCollapsed(function (c) { return Object.assign({}, c, { __ungrouped: !ungCollapsed }) }) } },
              'Ungrouped', h('span', { className: 'pinsb_count' }, String(model.ungrouped.length))))
            if (!ungCollapsed) model.ungrouped.forEach(function (s) { sections.push(renderRow(s, false, null)) })
          }
          if (wsPhase !== 'ready' || sessionsPhase === 'pending') {
            sections.push(h('div', { key: 'loading', className: 'pinsb_empty' }, 'Loading…'))
          } else if (model.visible.length === 0) {
            sections.push(h('div', { key: 'empty', className: 'pinsb_empty' }, 'No chats yet — start a new one with + above.'))
          }
        }

        var menuModel = null
        if (menu !== null) {
          var items = []
          if (menu.kind === 'session') {
            ;(function () {
              var isPinned = (pins.sessions || {})[menu.id] !== undefined
              items = [
                { id: 'pin', label: isPinned ? 'Unpin chat' : 'Pin chat', onPick: function () { togglePin('session', menu.id); setMenu(null) } },
                { id: 'rename', label: 'Rename…', onPick: function () { setRenaming({ kind: 'session', id: menu.id }); setMenu(null) } },
                { id: 'fork', label: 'Fork', onPick: function () { var id = menu.id; setMenu(null); svc.forkSession(id).catch(function (e) { notify(e && e.message ? e.message : e) }) } },
                { id: 'archive', label: 'Archive', danger: true, onPick: function () { var id = menu.id; setMenu(null); svc.archiveSession(id).catch(function (e) { notify(e && e.message ? e.message : e) }) } },
              ]
            })()
          } else {
            ;(function () {
              var isPinned = (pins.workspaces || {})[menu.id] !== undefined
              var confirming = confirmDelete === menu.id
              items = [
                { id: 'pin', label: isPinned ? 'Unpin project' : 'Pin project', onPick: function () { togglePin('workspace', menu.id); setMenu(null) } },
                { id: 'newchat', label: 'New chat here', onPick: function () { var id = menu.id; setMenu(null); try { svc.startSession(id) } catch (e) { notify(e.message) } } },
                { id: 'rename', label: 'Rename…', onPick: function () { setRenaming({ kind: 'workspace', id: menu.id }); setMenu(null) } },
                { id: 'delete', label: confirming ? 'Click again to delete' : 'Delete project…', danger: true, onPick: function () {
                  if (!confirming) { setConfirmDelete(menu.id); return }
                  var id = menu.id
                  setMenu(null)
                  svc.deleteWorkspace(id).catch(function (e) { notify(e && e.message ? e.message : e) })
                } },
              ]
            })()
          }
          menuModel = h(Menu, { menu: menu, items: items, onClose: function () { setMenu(null); setConfirmDelete(null) } })
        }

        return h('div', { className: 'pinsb_root', ref: rootRef },
          h('div', { className: 'pinsb_header' },
            h('span', { className: 'pinsb_headerTitle' }, 'Chats'),
            h('div', { className: 'pinsb_headerActions' },
              h('button', {
                className: 'pinsb_iconBtn', title: searchOpen ? 'Close search' : 'Search chats',
                onClick: function () { setSearchOpen(!searchOpen); if (searchOpen) setQuery('') },
              }, h(Icon, { name: searchOpen ? 'close' : 'search' })),
              h('button', { className: 'pinsb_iconBtn', title: 'New chat', onClick: function () { try { svc.startSession(undefined) } catch (e) { notify(e.message) } } }, h(Icon, { name: 'plus' })),
              h('button', { className: 'pinsb_iconBtn', title: 'Add workspace…', onClick: function () { svc.addWorkspace().catch(function (e) { notify(e && e.message ? e.message : e) }) } }, h(Icon, { name: 'folderPlus' })))),
          searchOpen ? h('div', { className: 'pinsb_search' },
            h('input', {
              className: 'pinsb_searchInput',
              placeholder: 'Search chats and projects…',
              value: query,
              autoFocus: true,
              onChange: function (e) { setQuery(e.target.value) },
              onKeyDown: function (e) { if (e.key === 'Escape') { setQuery(''); setSearchOpen(false) } },
            })) : null,
          notice ? h('div', { className: 'pinsb_notice' },
            h('span', null, notice),
            h('button', { className: 'pinsb_iconBtn', onClick: function () { setNotice(null) } }, h(Icon, { name: 'close' }))) : null,
          h('div', { className: 'pinsb_scroll' }, sections),
          menuModel)
      }

      slots.inject('sidebar.workspaces', function () {
        return slots.register(
          { name: 'sidebar.workspaces', priority: -10 },
          function (props) { return h(Browser, props) }
        )
      })
    }

    module.exports = { name: 'pinned-chats', inject: ['slots', 'sessions', 'uiWorkspace', 'workspaces'], apply: apply }
    return module.exports
  },
})
