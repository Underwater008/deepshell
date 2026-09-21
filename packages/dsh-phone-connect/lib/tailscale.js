import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { ConnectionState, normalizeHostname } from './persistent.js'

const APP_CLI = '/Applications/Tailscale.app/Contents/MacOS/Tailscale'

export function funnelSetupUrl(output) {
  // Forward only Tailscale's documented approval link, never arbitrary CLI
  // output, account details, or authentication URLs.
  return String(output).match(/https:\/\/login\.tailscale\.com\/f\/funnel\?node=[A-Za-z0-9_-]+(?=\s|$)/)?.[0] ?? null
}

async function execute(binary, args) {
  return new Promise((resolve, reject) => {
    execFile(binary, args, {
      timeout: 20000, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, TAILSCALE_BE_CLI: '1' },
    }, (error, stdout, stderr) => {
      if (error) {
        const setupUrl = args[0] === 'funnel' ? funnelSetupUrl(`${stdout}\n${stderr}`) : null
        if (setupUrl) {
          reject(Object.assign(new Error('Approve HTTPS and Funnel in Tailscale, then try Enable permanent access again.'), { setupUrl }))
          return
        }
        // Don't echo account/device inventory or sign-in tokens into the API.
        reject(new Error('Tailscale could not complete this step. Open Tailscale on this Mac, sign in, and enable HTTPS/Funnel for this device.'))
      } else resolve(String(stdout))
    })
  })
}

export class TailscaleConnection {
  constructor({ stateDir, port = 3080, run = execute }) {
    this.state = new ConnectionState(stateDir)
    this.port = port
    this.run = run
  }

  get target() { return `http://127.0.0.1:${this.port}` }

  async binary() {
    for (const binary of [APP_CLI, '/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale']) {
      try { await access(binary, constants.X_OK); return binary } catch {}
    }
    return null
  }

  async inspect() {
    const binary = await this.binary()
    if (!binary) return { installed: false, connected: false, hostname: null, serve: {} }
    const status = JSON.parse(await this.run(binary, ['status', '--json']))
    const connected = status.BackendState === 'Running' && status.Self?.Online !== false
    if (!connected || !status.Self?.DNSName) return { installed: true, connected: false, hostname: null, serve: {} }
    const hostname = normalizeHostname(status.Self.DNSName.replace(/\.$/, ''))
    if (!hostname.endsWith('.ts.net')) throw new Error('Enable MagicDNS for this Tailscale device first.')
    const serve = JSON.parse(await this.run(binary, ['funnel', 'status', '--json'])) || {}
    return { installed: true, connected: true, hostname, serve }
  }

  ownsRoute(serve, hostname) {
    const handler = serve.Web?.[`${hostname}:443`]?.Handlers
    const tcp = serve.TCP?.['443']
    return tcp?.HTTPS === true && !tcp.TCPForward && handler && Object.keys(handler).length === 1 &&
      handler['/']?.Proxy === this.target && Object.keys(handler['/']).length === 1 &&
      Object.keys(serve.Web ?? {}).filter(key => key.endsWith(':443')).every(key => key === `${hostname}:443`)
  }

  isActive(view, hostname) {
    return view.connected && view.hostname === hostname && this.ownsRoute(view.serve, hostname) &&
      view.serve.AllowFunnel?.[`${hostname}:443`] === true
  }

  async status() {
    const config = await this.state.read()
    let view, error = null
    try { view = await this.inspect() } catch (failure) {
      view = { installed: Boolean(await this.binary()), connected: false, hostname: null }
      error = failure.message
    }
    return {
      configured: config !== null,
      enabled: config?.enabled ?? false,
      installed: view.installed,
      connected: view.connected,
      active: Boolean(config?.enabled && this.isActive(view, config.hostname)),
      hostname: config?.hostname ?? null,
      bookmarkUrl: config ? `https://${config.hostname}/` : null,
      error,
    }
  }

  async activate(view, hostname) {
    if (!view.installed) throw new Error('Install Tailscale on this Mac first. Your iPhone only needs a browser, such as Chrome or Safari.')
    if (!view.connected) throw new Error('Open Tailscale on this Mac and sign in before enabling phone access.')
    if (view.hostname !== hostname) throw new Error('The Tailscale device address changed. Turn off phone access and pair again on this Mac.')
    if (this.isActive(view, hostname)) return
    if (view.serve.TCP?.['443'] && !this.ownsRoute(view.serve, hostname)) {
      throw new Error('Tailscale HTTPS port 443 is already serving another app. DeepShell has left it unchanged.')
    }
    // Refuse a shared HTTPS listener even if its TCP entry is absent/malformed.
    if (Object.keys(view.serve.Web ?? {}).some(key => key.endsWith(':443')) && !this.ownsRoute(view.serve, hostname)) {
      throw new Error('Tailscale HTTPS port 443 is already serving another app. DeepShell has left it unchanged.')
    }
    await this.run(await this.binary(), ['funnel', '--bg', '--yes', '--https=443', this.target])
    if (!this.isActive(await this.inspect(), hostname)) throw new Error('Funnel has not enabled the DeepShell address yet. Finish its setup in Tailscale and retry.')
  }

  async enable() {
    const view = await this.inspect()
    if (!view.installed) throw new Error('Install Tailscale on this Mac first. Your iPhone only needs a browser, such as Chrome or Safari.')
    if (!view.connected) throw new Error('Open Tailscale on this Mac and sign in before enabling phone access.')
    let config = await this.state.read()
    if (!config?.enabled) config = await this.state.configure('tailscale-funnel', view.hostname)
    await this.activate(view, config.hostname)
    await this.state.setEnabled(true)
    await this.state.prepareTrust()
    return `https://${config.hostname}/`
  }

  async resume() {
    const config = await this.state.read()
    if (!config?.enabled) return false
    await this.state.prepareTrust()
    await this.activate(await this.inspect(), config.hostname)
    return true
  }

  async suspend() {
    const config = await this.state.read()
    if (!config) return
    const view = await this.inspect()
    if (config.enabled && !view.connected) throw new Error('Reconnect Tailscale on this Mac to turn off its saved phone listener.')
    if (view.connected && view.hostname === config.hostname && this.ownsRoute(view.serve, config.hostname)) {
      await this.run(await this.binary(), ['funnel', '--https=443', 'off'])
    }
  }

  async disable() {
    // Stop first. If the provider is unavailable, don't falsely report that
    // its public listener has been removed or discard the retry state.
    await this.suspend()
    if (await this.state.read()) await this.state.setEnabled(false)
  }
}
