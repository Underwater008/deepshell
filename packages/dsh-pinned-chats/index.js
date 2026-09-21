// dsh-pinned-chats — a Cordis plugin for the DeepSeek Harness that adds
// pinning to the sidebar: pinned chats (sessions) collect in a "Pinned"
// section on top, pinned projects (workspaces) float above the other groups.
//
// Host half: two exact Fetch routes behind the harness's normal browser-auth
// fence (cookie session, Host/Origin checks):
//
//   GET  /api/pins        → { sessions: {id: pinnedAt}, workspaces: {id: pinnedAt} }
//   POST /api/pins/toggle { kind: "session"|"workspace", id }
//                         → the same snapshot after toggling
//
// Pin state lives in the `sidebar_pins` storage domain (one `pins` table
// keyed by session/workspace id, records { kind, pinnedAt }), so pins survive
// restarts and are shared by every browser session of this process. The
// domain layer validates records through zod-shaped schemas; to keep this
// package dependency-free the schema is the two methods it actually calls
// (parse/safeParse). A second holder of the domain (a dynamic twin plugin in
// some session) is reused rather than fought: whoever opened it owns closing.

export const name = 'pinned-chats'
export const inject = ['connection', 'timer', 'storageDomain']

const DOMAIN_NAME = 'sidebar_pins'
const LIST_PATH = '/api/pins'
const TOGGLE_PATH = '/api/pins/toggle'

// Minimal zod-shaped validator: dsh-storage-domain only calls parse/safeParse.
const pinSchema = {
  parse(value) {
    if (typeof value !== 'object' || value === null) throw new Error('pin record must be an object')
    if (value.kind !== 'session' && value.kind !== 'workspace') throw new Error('pin kind must be session or workspace')
    if (typeof value.pinnedAt !== 'number' || !Number.isFinite(value.pinnedAt)) throw new Error('pin pinnedAt must be a finite number')
    return { kind: value.kind, pinnedAt: value.pinnedAt }
  },
  safeParse(value) {
    try {
      return { success: true, data: pinSchema.parse(value) }
    } catch (error) {
      return { success: false, error }
    }
  },
}

class PinStore {
  constructor(ctx) {
    this.ctx = ctx
    this.storageDomain = ctx.get('storageDomain')
    this.domain = null
    this.ownedDomain = false
    this.table = null
    this.opening = null
    // Last-resort memory store (storage service absent or mount racing).
    this.memory = { sessions: {}, workspaces: {} }
  }

  async open() {
    if (this.table !== null || this.storageDomain === undefined) return
    if (this.opening !== null) return this.opening
    this.opening = this.openWithRetry()
    try {
      await this.opening
    } finally {
      this.opening = null
    }
  }

  async openWithRetry() {
    let lastError = null
    for (let attempt = 0; attempt < 4 && this.table === null; attempt += 1) {
      try {
        this.domain = await this.storageDomain.open({
          name: DOMAIN_NAME,
          version: 1,
          tables: { pins: { valueSchema: pinSchema } },
        })
        this.ownedDomain = true
        this.table = this.domain.table('pins')
        return
      } catch (error) {
        lastError = error
        const text = String((error && (error.code || error.message)) || error)
        // Another holder (e.g. a dynamic twin of this plugin) already has the
        // domain open: reuse it and never close what we did not open.
        if (/already-open/.test(text)) {
          const existing = this.storageDomain.get(DOMAIN_NAME)
          if (existing !== undefined) {
            this.domain = existing
            this.ownedDomain = false
            this.table = existing.table('pins')
            return
          }
        }
        if (attempt < 3) await this.ctx.timeout(150)
      }
    }
    console.error('pinned-chats: durable store unavailable, pins live in memory only', lastError)
  }

  isClosedError(error) {
    return Boolean(error) && (error.code === 'closed' || /closed/.test(String(error.message || error)))
  }

  // Run fn(table) with a live handle, re-opening once when a borrowed handle
  // died underneath us (its owner closed it). fn(null) is the memory fallback;
  // a handle that fails twice in a row is loud (the route answers 500).
  async withTable(fn) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await this.open()
      if (this.table === null) return fn(null)
      try {
        return await fn(this.table)
      } catch (error) {
        if (!this.isClosedError(error) || attempt === 1) throw error
        this.table = null
        this.domain = null
        this.ownedDomain = false
      }
    }
    throw new Error('pinned-chats: withTable exhausted')
  }

  snapshot() {
    return this.withTable((table) => {
      const out = { sessions: {}, workspaces: {} }
      if (table !== null) {
        for (const [id, rec] of table.entries()) {
          if (rec && rec.kind === 'session') out.sessions[id] = rec.pinnedAt
          else if (rec && rec.kind === 'workspace') out.workspaces[id] = rec.pinnedAt
        }
      } else {
        out.sessions = { ...this.memory.sessions }
        out.workspaces = { ...this.memory.workspaces }
      }
      return out
    })
  }

  async toggle(kind, id) {
    return this.withTable(async (table) => {
      if (table !== null) {
        if (table.get(id) !== undefined) await table.delete(id)
        else await table.put(id, { kind, pinnedAt: Date.now() })
        return
      }
      const bucket = kind === 'session' ? this.memory.sessions : this.memory.workspaces
      if (bucket[id] !== undefined) delete bucket[id]
      else bucket[id] = Date.now()
    })
  }

  close() {
    const d = this.domain
    this.domain = null
    this.table = null
    if (d !== null && this.ownedDomain) d.close().catch(() => {})
    this.ownedDomain = false
  }
}

export function apply(ctx) {
  const store = new PinStore(ctx)

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: LIST_PATH,
        methods: ['GET'],
        // Buffered even for GET: the connection bridge treats an unset
        // requestBody as streaming and builds a GET Request with a body,
        // which throws and surfaces as a 400 before the handler runs.
        requestBody: 'buffered',
        fetch: async () => {
          return Response.json(await store.snapshot())
        },
      }),
    'pinned-chats: /api/pins route',
  )

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: TOGGLE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          let body
          try {
            body = await request.json()
          } catch {
            return Response.json({ ok: false, error: 'body must be JSON: {"kind":"session"|"workspace","id":"…"}' }, { status: 400 })
          }
          const kind = body && body.kind
          const id = body && body.id
          if ((kind !== 'session' && kind !== 'workspace') || typeof id !== 'string' || id === '') {
            return Response.json({ ok: false, error: 'kind must be "session" or "workspace" and id a non-empty string' }, { status: 400 })
          }
          await store.toggle(kind, id)
          return Response.json(await store.snapshot())
        },
      }),
    'pinned-chats: /api/pins/toggle route',
  )

  // Warm the domain at mount so the first list call is fast.
  ctx.effect(() => {
    store.open().catch(() => {})
    return () => store.close()
  }, 'pinned-chats: pin store')
}
