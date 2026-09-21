import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgDir = path.join(here, '..')

async function loadClientBundle(opts = {}) {
  const src = await readFile(path.join(pkgDir, 'lib', 'client.js'), 'utf8')
  const registrations = []
  const sandbox = makeSandbox(registrations, opts)
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox, { filename: 'lib/client.js' })
  assert.equal(registrations.length, 1, 'the bundle registers exactly one client module')
  assert.equal(registrations[0].id, 'dsh-mobile-ui')
  return { factory: registrations[0].factory, sandbox }
}

function makeElementStub(tag = 'div') {
  const listeners = new Map()
  return {
    tag,
    attrs: new Map(),
    dataset: {},
    style: {
      props: new Map(),
      setProperty(name, value) { this.props.set(name, value) },
      removeProperty(name) { this.props.delete(name) },
    },
    children: [],
    textContent: '',
    parentElement: null,
    setAttribute(name, value) { this.attrs.set(name, String(value)) },
    getAttribute(name) { return this.attrs.has(name) ? this.attrs.get(name) : null },
    hasAttribute(name) { return this.attrs.has(name) },
    appendChild(child) { this.children.push(child); child.parentElement = this; return child },
    remove() {},
    addEventListener(type, fn) { listeners.set(type, fn) },
    removeEventListener(type) { listeners.delete(type) },
    listener(type) { return listeners.get(type) },
  }
}

function makeSandbox(registrations, opts = {}) {
  const head = makeElementStub('head')
  const docEl = makeElementStub('html')
  const documentListeners = new Map()
  // A minimal desktop frame: the shell overlay layer inside the AppFrame grid.
  // Tests toggle the sidebar through data-sidebar-collapsed on the frame.
  const frame = makeElementStub('div')
  if (opts.sidebarCollapsed === true) frame.setAttribute('data-sidebar-collapsed', '')
  const overlay = makeElementStub('div')
  overlay.setAttribute('data-shell-overlay', '')
  frame.appendChild(overlay)
  const document = {
    head,
    documentElement: docEl,
    createElement: (tag) => makeElementStub(tag),
    querySelector: (selector) => (selector === '[data-shell-overlay]' ? overlay : null),
    addEventListener: (type, fn) => documentListeners.set(type, fn),
    removeEventListener: (type) => documentListeners.delete(type),
    listener: (type) => documentListeners.get(type),
  }
  const windowListeners = new Map()
  const window = {
    innerHeight: 800,
    matchMedia: () => ({ matches: opts.mobile === true, addEventListener() {}, removeEventListener() {} }),
    addEventListener: (type, fn) => windowListeners.set(type, fn),
    removeEventListener: (type) => windowListeners.delete(type),
    requestAnimationFrame: (fn) => { fn(); return 1 },
    cancelAnimationFrame: () => {},
    setTimeout: (fn) => { fn(); return 1 },
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    __ModuleLoader__: { load: (entry) => registrations.push(entry) },
  }
  return {
    window,
    document,
    MutationObserver: class {
      constructor() {}
      observe() {}
      disconnect() {}
    },
    console,
  }
}

function makeReactMock() {
  const cleanups = []
  const React = {
    Fragment: Symbol('Fragment'),
    createElement(type, props, ...children) {
      if (typeof type === 'function') return type({ ...(props ?? {}), children })
      if (type === React.Fragment) return { fragment: true, children }
      return { type, props: props ?? {}, children }
    },
    useState(initial) {
      return [typeof initial === 'function' ? initial() : initial, () => {}]
    },
    useEffect(fn) {
      const cleanup = fn()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
  }
  return { React, cleanups }
}

function makeCtx() {
  const effects = []
  const slotInjections = []
  const services = new Map([
    ['layout', { toggleSidebar() { this.toggled = (this.toggled ?? 0) + 1 } }],
    ['uiWorkspace', { startSession() { this.started = (this.started ?? 0) + 1 } }],
  ])
  const ctx = {
    effect(fn, label) {
      const dispose = fn()
      effects.push({ label, dispose })
    },
    slots: {
      inject(name, thunk) {
        slotInjections.push({ name, registration: thunk() })
      },
      register(options, component) {
        return { options, component }
      },
    },
    get(name) {
      return services.get(name)
    },
    service(name) {
      return services.get(name)
    },
  }
  return { ctx, effects, slotInjections, services }
}

test('client bundle declares its services and mounts every effect', async () => {
  const { factory } = await loadClientBundle({ mobile: true })
  const { React, cleanups } = makeReactMock()
  const mod = factory((id) => {
    assert.equal(id, 'react', 'the bundle only requires react')
    return React
  })
  assert.equal(mod.name, 'mobile-ui')
  assert.deepEqual([...mod.inject].sort(), ['layout', 'slots', 'uiWorkspace'])
  assert.equal(typeof mod.apply, 'function')

  const { ctx, effects, slotInjections } = makeCtx()
  mod.apply(ctx)

  const labels = effects.map((effect) => effect.label)
  assert.ok(labels.includes('mobile-ui: viewport meta'))
  assert.ok(labels.includes('mobile-ui: app viewport'))
  assert.ok(labels.includes('mobile-ui: styles'))
  assert.ok(labels.includes('mobile-ui: drawer dismiss'))

  assert.equal(slotInjections.length, 1, 'one slot injection')
  assert.equal(slotInjections[0].name, 'shell.overlay')
  const { options, component } = slotInjections[0].registration
  assert.equal(options.name, 'shell.overlay')
  assert.equal(options.id, 'mobile-ui.chrome')
  assert.equal(typeof component, 'function')

  // The registered chrome renders with the slot's standard props.
  const tree = component({
    useSessions: (select) => select({ current: 's1', byId: { s1: { title: 'Release plan' } } }),
    usePanelInfo: (select) => select({ activePanelId: null }),
  })
  const bar = tree.children.find((child) => child && child.type === 'div' && child.props.className === 'dsh-mui-bar')
  assert.ok(bar, 'renders the top bar')
  const title = bar.children.find((child) => child && child.props && child.props.className === 'dsh-mui-title')
  assert.deepEqual(title.children, ['Release plan'])

  for (const cleanup of cleanups) cleanup()
})

test('panel and fallback titles project into the bar', async () => {
  const { factory } = await loadClientBundle({ mobile: true })
  const { React } = makeReactMock()
  const mod = factory(() => React)
  const { ctx, slotInjections } = makeCtx()
  mod.apply(ctx)
  const { component } = slotInjections[0].registration

  const panelTree = component({
    useSessions: (select) => select({ current: undefined, byId: {} }),
    usePanelInfo: (select) => select({ activePanelId: 'jobs' }),
  })
  const panelBar = panelTree.children.find((child) => child && child.props && child.props.className === 'dsh-mui-bar')
  const panelTitle = panelBar.children.find((child) => child && child.props && child.props.className === 'dsh-mui-title')
  assert.deepEqual(panelTitle.children, ['Jobs'])

  const bareTree = component({ useSessions: undefined, usePanelInfo: undefined })
  const bareBar = bareTree.children.find((child) => child && child.props && child.props.className === 'dsh-mui-bar')
  const bareTitle = bareBar.children.find((child) => child && child.props && child.props.className === 'dsh-mui-title')
  assert.deepEqual(bareTitle.children, ['DeepSeek Harness'])
})

test('desktop viewport renders no chrome even with the sidebar expanded', async () => {
  // Regression: an expanded desktop sidebar reads as "drawer open"; the
  // backdrop used to mount globally, dimming the app and swallowing clicks.
  const { factory } = await loadClientBundle({ mobile: false, sidebarCollapsed: false })
  const { React } = makeReactMock()
  const mod = factory(() => React)
  const { ctx, slotInjections } = makeCtx()
  mod.apply(ctx)
  const { component } = slotInjections[0].registration
  const tree = component({
    useSessions: (select) => select({ current: 's1', byId: { s1: { title: 'Release plan' } } }),
    usePanelInfo: (select) => select({ activePanelId: null }),
  })
  assert.equal(tree, null, 'desktop mounts no mobile chrome at all')
})

test('mobile viewport shows the backdrop only while the drawer is open', async () => {
  const { factory } = await loadClientBundle({ mobile: true, sidebarCollapsed: false })
  const { React } = makeReactMock()
  const mod = factory(() => React)
  const { ctx, slotInjections, services } = makeCtx()
  mod.apply(ctx)
  const { component } = slotInjections[0].registration
  const props = {
    useSessions: (select) => select({ current: undefined, byId: {} }),
    usePanelInfo: (select) => select({ activePanelId: null }),
  }
  const tree = component(props)
  const backdrop = tree.children.find((child) => child && child.props && child.props.className === 'dsh-mui-backdrop')
  assert.ok(backdrop, 'backdrop renders on mobile while the drawer is open')
  backdrop.props.onClick()
  assert.equal(services.get('layout').toggled, 1, 'backdrop tap collapses the drawer')

  const closedBundle = await loadClientBundle({ mobile: true, sidebarCollapsed: true })
  const closedMod = closedBundle.factory(() => React)
  const closed = makeCtx()
  closedMod.apply(closed.ctx)
  const closedTree = closed.slotInjections[0].registration.component(props)
  assert.ok(
    !closedTree.children.some((child) => child && child.props && child.props.className === 'dsh-mui-backdrop'),
    'no backdrop once the drawer is closed',
  )
})

function stripMediaBlocks(css, query) {
  const needle = `@media ${query}`
  let stripped = ''
  let i = 0
  while (i < css.length) {
    const start = css.indexOf(needle, i)
    if (start === -1) {
      stripped += css.slice(i)
      break
    }
    stripped += css.slice(i, start)
    let depth = 0
    let j = css.indexOf('{', start)
    for (; j < css.length; j += 1) {
      if (css[j] === '{') depth += 1
      else if (css[j] === '}') {
        depth -= 1
        if (depth === 0) {
          j += 1
          break
        }
      }
    }
    i = j
  }
  return stripped
}

test('backdrop styling exists only inside the mobile media query', async () => {
  // Regression: the backdrop rule used to live outside @media (max-width:
  // 768px), so it painted on desktop. String-needle checks cannot catch
  // placement; brace-match the rendered stylesheet instead.
  const { factory, sandbox } = await loadClientBundle()
  const { React } = makeReactMock()
  const mod = factory(() => React)
  const { ctx } = makeCtx()
  mod.apply(ctx)
  const styleTag = sandbox.document.head.children.find((child) => child.tag === 'style')
  assert.ok(styleTag, 'stylesheet installed')
  const css = styleTag.textContent
  assert.ok(css.includes('.dsh-mui-backdrop'), 'backdrop rule exists')
  const outsideMobile = stripMediaBlocks(css, '(max-width: 768px)')
  const rule = outsideMobile.match(/\.dsh-mui-backdrop\s*\{([^}]*)\}/)
  const body = rule === null ? '' : rule[1]
  assert.ok(
    !/(position|inset|z-index|background)\s*:/.test(body),
    'no backdrop layout/paint rule outside the mobile media query',
  )
})

test('stylesheet targets the keyboard fix, the drawer, and safe areas', async () => {
  const src = await readFile(path.join(pkgDir, 'lib', 'client.js'), 'utf8')
  for (const needle of [
    '(max-width: 768px)',
    '--dsh-app-height',
    '--dsh-app-offset-top',
    'interactive-widget=resizes-content',
    'viewport-fit=cover',
    '[data-slot="sidebar"]',
    '[data-slot="main"]',
    '[data-shell-overlay]',
    'data-sidebar-collapsed',
    'safe-area-inset-top',
    'safe-area-inset-bottom',
    'font-size: 16px',
    'dsh-mui-bar',
    'dsh-mui-backdrop',
  ]) {
    assert.ok(src.includes(needle), `client bundle mentions ${needle}`)
  }
})

test('package manifest wires the web client platform', async () => {
  const manifest = JSON.parse(await readFile(path.join(pkgDir, 'package.json'), 'utf8'))
  assert.equal(manifest.main, 'index.js')
  assert.equal(manifest.exports['./client'].default, './lib/client.js')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.ok(manifest.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-layout'))
  const host = await import(path.join(pkgDir, 'index.js'))
  assert.equal(typeof host.apply, 'function')
  host.apply()
})
