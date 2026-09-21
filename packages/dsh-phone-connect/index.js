// dsh-phone-connect — a Cordis plugin for the DeepSeek Harness that puts
// DeepShell's phone-connect controls (deepshell.sh tunnel|local, the
// menu-bar Phone menu) on a Settings → Plugins card inside the web UI.
//
// Host half: one exact Fetch route, /api/phone-connect, behind the harness's
// normal browser-auth fence (cookie session, Host/Origin checks):
//
//   GET  → live status: effective mode, forwarder processes, tool paths,
//          phone URL (with the launch token), and a QR PNG as a data URL.
//   POST { mode: "tunnel" | "local" }
//        → performs the same steps as deepshell.sh (state files under
//          ~/Library/Application Support/deepshell, persistent Tailscale
//          Funnel forwarding), then schedules a
//          launchd kickstart of the harness service 2s later — trusted hosts
//          are a launch-time flag, so applying always restarts the harness.
//          The browser page keeps its signed session cookie across the
//          restart and reconnects on its own; the card polls GET until the
//          new launch answers (token rotates = restart observed).
//
// Row config (all optional; defaults match deepshell.sh):
//   port:        harness port                (default 3080)
//   label:       launchd service label       (default local.deepshell)
//   stateDir:    DeepShell state directory   (default ~/Library/Application Support/deepshell)
//
// The package also installs a `phone-connect` settings namespace mirroring
// that row config. Beyond making the values visible/editable in
// ~/.dsh/settings.yaml, the served namespace is load-bearing for the card:
// the Settings → Plugins tab renders the intersection of served settings
// namespaces and cards registered into settings.plugin.item — a card whose
// namespace the Host does not serve is never dispatched (see
// dsh-client-ui-settings-plugins).

import { execFile, spawn } from 'node:child_process'
import { constants as fsConstants, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { TailscaleConnection, funnelSetupUrl } from './lib/tailscale.js'

export const name = 'phone-connect'
export const inject = ['connection']

const ROUTE_PATH = '/api/phone-connect'
const SETTINGS_NAMESPACE = 'phone-connect'
const DEFAULT_PORT = 3080
const DEFAULT_LABEL = 'local.deepshell'

const TOOL_DIRS = ['/opt/homebrew/bin', '/usr/local/bin']
const TOOL_PATH = [...TOOL_DIRS, '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':')
const TOKEN_URL_RE = /http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+/g
const TOKEN_RE = /[?&]token=([A-Za-z0-9_-]+)/
const TUNNEL_HOST_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/

function normalizeConfig(input) {
  const out = { port: DEFAULT_PORT, label: DEFAULT_LABEL, stateDir: '' }
  if (input === undefined || input === null) return out
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('phone-connect: config must be an object')
  }
  for (const key of ['port']) {
    if (input[key] !== undefined) {
      if (!Number.isInteger(input[key]) || input[key] < 1 || input[key] > 65535) {
        throw new Error(`phone-connect: ${key} must be an integer between 1 and 65535`)
      }
      out[key] = input[key]
    }
  }
  if (input.label !== undefined) {
    if (typeof input.label !== 'string' || input.label.length === 0) {
      throw new Error('phone-connect: label must be a non-empty string')
    }
    out.label = input.label
  }
  if (input.stateDir !== undefined) {
    if (typeof input.stateDir !== 'string') {
      throw new Error('phone-connect: stateDir must be a string (empty uses the default directory)')
    }
    out.stateDir = input.stateDir
  }
  return out
}

// The dsh-settings service drives schemas as plain callables plus toJSON()
// (same dependency-free pattern as dsh-web-search-searxng).
const JSON_SCHEMA = {
  type: 'object',
  properties: {
    port: { type: 'number', default: DEFAULT_PORT },
    label: { type: 'string', default: DEFAULT_LABEL },
    stateDir: { type: 'string', default: '' },
  },
}

function schema(value) {
  return normalizeConfig(value)
}
schema.toJSON = () => JSON_SCHEMA

function sh(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: 15000,
        maxBuffer: 8 * 1024 * 1024,
        ...options,
        env: { ...process.env, PATH: `${TOOL_PATH}:${process.env.PATH ?? ''}`, ...(options.env ?? {}) },
      },
      (error, stdout, stderr) => {
        if (error) {
          error.stderr = typeof stderr === 'string' ? stderr : ''
          reject(error)
        } else {
          resolve({ stdout, stderr })
        }
      },
    )
  })
}

async function readTrim(file) {
  try {
    const text = await fs.readFile(file, 'utf8')
    const trimmed = text.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

async function findTool(tool) {
  for (const dir of TOOL_DIRS) {
    const candidate = path.join(dir, tool)
    try {
      await fs.access(candidate, fsConstants.X_OK)
      return candidate
    } catch {}
  }
  try {
    const { stdout } = await sh('which', [tool])
    const found = String(stdout).trim()
    return found.length > 0 ? found : null
  } catch {
    return null
  }
}

export class PhoneConnectController {
  constructor(connection, resolveOptions) {
    this.connection = connection
    this.resolveOptions = resolveOptions
    this.applyOptions()
  }

  // Re-resolve paths from the live options thunk: row config seeds them, and
  // settings.yaml edits (phone-connect section) apply on the next request.
  applyOptions() {
    const options = this.resolveOptions()
    this.options = options
    const home = os.homedir()
    this.stateDir = options.stateDir || path.join(home, 'Library', 'Application Support', 'deepshell')
    this.runDir = path.join(this.stateDir, 'run')
    this.modeFile = path.join(this.stateDir, 'mode')
    this.trustedHostsFile = path.join(this.stateDir, 'trusted-hosts')
    this.logFile = path.join(this.runDir, 'deepshell.log')
    this.tunnelLog = path.join(this.runDir, 'cloudflared.log')
    this.plist = path.join(home, 'Library', 'LaunchAgents', `${options.label}.plist`)
    this.permanent = new TailscaleConnection({ stateDir: this.stateDir, port: this.port })
  }

  get port() {
    return this.options.port
  }

  get label() {
    return this.options.label
  }

  findTool(tool) {
    return findTool(tool)
  }

  tunnelPattern() {
    return `cloudflared tunnel --url http://127.0.0.1:${this.port}`
  }

  legacyForwarderPattern() {
    // Remove forwarders left behind by versions that offered LAN access.
    return 'socat TCP-LISTEN:3081'
  }

  async processRunning(pattern) {
    try {
      await sh('pgrep', ['-f', pattern])
      return true
    } catch {
      return false
    }
  }

  async pkillQuiet(pattern) {
    try {
      await sh('pkill', ['-f', pattern])
    } catch {}
  }

  async managed() {
    try {
      await fs.access(this.plist)
    } catch {
      return false
    }
    const uid = typeof process.getuid === 'function' ? process.getuid() : undefined
    if (uid === undefined) return false
    try {
      await sh('launchctl', ['print', `gui/${uid}/${this.label}`], { timeout: 8000, maxBuffer: 1024 * 1024 })
      return true
    } catch {
      return false
    }
  }

  // Fresh launch-token URL: in-memory from the connection service when it
  // exposes authenticatedUrl, else scraped from the launchd stdout log the
  // same way deepshell.sh does it.
  async currentTokenUrl() {
    try {
      const url = this.connection?.authenticatedUrl?.(`http://127.0.0.1:${this.port}/`)
      if (typeof url === 'string' && TOKEN_RE.test(url)) return url
    } catch {}
    try {
      const log = await fs.readFile(this.logFile, 'utf8')
      const matches = log.match(TOKEN_URL_RE)
      if (matches && matches.length > 0) return matches[matches.length - 1]
    } catch {}
    return null
  }

  async tunnelHostFromLog() {
    try {
      const log = await fs.readFile(this.tunnelLog, 'utf8')
      const match = log.match(TUNNEL_HOST_RE)
      return match ? match[0].slice('https://'.length) : null
    } catch {
      return null
    }
  }

  async qrDataUrl(url) {
    const qrencode = await this.findTool('qrencode')
    if (qrencode === null) return null
    try {
      const { stdout } = await sh(qrencode, ['-o', '-', '-t', 'PNG', '-s', '8', '-m', '2', url], { encoding: 'buffer' })
      if (!Buffer.isBuffer(stdout) || stdout.length === 0) return null
      return `data:image/png;base64,${stdout.toString('base64')}`
    } catch {
      return null
    }
  }

  async status() {
    const permanent = await this.permanent.status()
    const [recordedMode, trustedHost, activeHost, legacyForwarderRunning, tunnelRunning, qrencode, cloudflared, isManaged, localUrl] =
      await Promise.all([
        readTrim(this.modeFile),
        readTrim(this.trustedHostsFile),
        this.tunnelHostFromLog(),
        this.processRunning(this.legacyForwarderPattern()),
        this.processRunning(this.tunnelPattern()),
        this.findTool('qrencode'),
        this.findTool('cloudflared'),
        this.managed(),
        this.currentTokenUrl(),
      ])

    let mode = 'local'
    if (trustedHost !== null && trustedHost === activeHost && tunnelRunning) mode = 'tunnel'
    if (permanent.enabled && permanent.active && trustedHost === permanent.hostname) mode = 'tunnel'

    const token = localUrl !== null ? (localUrl.match(TOKEN_RE)?.[1] ?? null) : null
    let phoneUrl = null
    if (token !== null) {
      if (mode === 'tunnel' && trustedHost !== null) phoneUrl = `https://${trustedHost}/?token=${token}`
    }

    return {
      ok: true,
      managed: isManaged,
      label: this.label,
      mode,
      permanent,
      recordedMode: recordedMode ?? 'local',
      // Stale exposure state the user can only clear with Turn off: a trusted
      // tunnel host on disk (would be trusted again on the next restart)
      // without a live cloudflared behind it.
      needsCleanup: mode !== 'tunnel' && (trustedHost !== null || tunnelRunning || legacyForwarderRunning || (recordedMode !== null && recordedMode !== 'local')),
      tunnelHost: mode === 'tunnel' ? trustedHost : null,
      tunnelRunning: tunnelRunning || permanent.active,
      tools: {
        qrencode: qrencode !== null,
        cloudflared: cloudflared !== null,
      },
      port: this.port,
      localUrl,
      bootId: token,
      phoneUrl,
      qrDataUrl: phoneUrl !== null ? await this.qrDataUrl(phoneUrl) : null,
    }
  }

  // Respond first, restart 2s later: trusted hosts are a launch-time flag, so
  // the harness has to restart — but this HTTP response must land first, and
  // the kicker must be detached so launchd can't take it down with the job.
  scheduleRestart() {
    const uid = typeof process.getuid === 'function' ? process.getuid() : undefined
    if (uid === undefined) throw new Error('phone-connect: process.getuid() unavailable on this platform')
    const child = spawn('/bin/bash', ['-c', 'sleep 2; exec /bin/launchctl kickstart -k "$1"', 'phone-connect', `gui/${uid}/${this.label}`], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
  }

  async enableTunnel() {
    await this.permanent.enable()
    await this.pkillQuiet(this.tunnelPattern())
    await this.pkillQuiet(this.legacyForwarderPattern())
    this.scheduleRestart()
    return { ok: true, restarting: true }
  }

  async resumePersistent() {
    if (this.changing || this.resuming) return
    this.resuming = this.permanent.resume()
    try { await this.resuming } finally { this.resuming = null }
  }

  async disable() {
    await this.permanent.disable()
    await fs.mkdir(this.runDir, { recursive: true })
    await fs.writeFile(this.modeFile, 'local\n')
    await fs.rm(this.trustedHostsFile, { force: true })
    await this.pkillQuiet(this.tunnelPattern())
    await this.pkillQuiet(this.legacyForwarderPattern())
    this.scheduleRestart()
    return { ok: true, restarting: true }
  }

  async handle(request) {
    try {
      this.applyOptions()
      if (request.method === 'GET') {
        return Response.json(await this.status())
      }
      if (request.method === 'POST') {
        let body
        try {
          body = await request.json()
        } catch {
          return Response.json({ ok: false, error: 'body must be JSON: {"mode":"tunnel"|"local"}' }, { status: 400 })
        }
        const mode = body?.mode
        if (mode !== 'tunnel' && mode !== 'local') {
          return Response.json({ ok: false, error: 'mode must be "tunnel" or "local"' }, { status: 400 })
        }
        if (!(await this.managed())) {
          return Response.json(
            {
              ok: false,
              error: `this harness is not running under the "${this.label}" launchd service — phone connect needs deepshell.sh install`,
            },
            { status: 409 },
          )
        }
        if (this.changing) return Response.json({ ok: false, error: 'Phone connect is already applying a change.' }, { status: 409 })
        this.changing = true
        let result
        try {
          if (this.resuming) await this.resuming.catch(() => {})
          result = mode === 'tunnel' ? await this.enableTunnel() : await this.disable()
        } catch (error) {
          this.changing = false
          throw error
        }
        return Response.json(result)
      }
      return new Response('method not allowed', { status: 405 })
    } catch (error) {
      const setupUrl = funnelSetupUrl(error?.setupUrl ?? '')
      return Response.json({ ok: false, error: String(error?.message ?? error), ...(setupUrl ? { setupUrl } : {}) }, { status: setupUrl ? 409 : 500 })
    }
  }
}

export function apply(ctx, config) {
  // Same pattern as the shipped web-search plugins: row config seeds the
  // options, and the settings section (when the settings service is present)
  // becomes the live source of truth. The served `phone-connect` namespace
  // is also what makes the Settings → Plugins tab dispatch the card at all —
  // it renders the intersection of served namespaces and registered cards.
  let current = () => normalizeConfig(config)
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, SETTINGS_NAMESPACE, schema, normalizeConfig(config), {
      setSource: (source) => {
        current = () => normalizeConfig(source())
      },
      onChange: () => {},
    })
  })
  const controller = new PhoneConnectController(ctx.connection, () => current())
  // Tailscale may come online after the harness at login. Retry only a saved,
  // explicitly enabled connection; never enable one on a fresh installation.
  ctx.effect(() => {
    let disposed = false
    const resume = () => {
      if (!disposed) controller.resumePersistent().catch(() => {})
    }
    const initial = setTimeout(resume, 3000)
    const retry = setInterval(resume, 30000)
    initial.unref?.()
    retry.unref?.()
    return () => { disposed = true; clearTimeout(initial); clearInterval(retry) }
  }, 'phone-connect: restore permanent access')
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: ROUTE_PATH,
        methods: ['GET', 'POST'],
        requestBody: 'buffered',
        fetch: (request) => controller.handle(request),
      }),
    'phone-connect: /api/phone-connect route',
  )
}
