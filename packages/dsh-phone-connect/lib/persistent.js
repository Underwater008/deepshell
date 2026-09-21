import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export function normalizeHostname(value) {
  if (typeof value !== 'string') throw new Error('A permanent HTTPS hostname is required.')
  const hostname = value.trim().toLowerCase().replace(/^https:\/\//, '').replace(/\/$/, '')
  if (hostname.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname) ||
      hostname.endsWith('.trycloudflare.com') || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('The permanent address must be a public hostname without a path or port.')
  }
  return hostname
}

export async function privateWrite(file, contents) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, contents, { mode: 0o600, flag: 'wx' })
    await rename(temporary, file)
  } finally {
    await rm(temporary, { force: true })
  }
}

export class ConnectionState {
  constructor(stateDir) {
    this.stateDir = stateDir
    this.file = path.join(stateDir, 'phone', 'connection.json')
  }

  async read() {
    let raw
    try { raw = await readFile(this.file, 'utf8') } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
    const config = JSON.parse(raw)
    if (config.version !== 1 || config.provider !== 'tailscale-funnel' || typeof config.enabled !== 'boolean') {
      throw new Error('The saved phone connection is invalid. Set it up again on this Mac.')
    }
    return { version: 1, provider: config.provider, hostname: normalizeHostname(config.hostname), enabled: config.enabled }
  }

  async configure(provider, hostname) {
    if (provider !== 'tailscale-funnel') throw new Error('Unsupported permanent connection provider.')
    hostname = normalizeHostname(hostname)
    const current = await this.read()
    if (current?.enabled) throw new Error('Turn off remote access before changing its permanent connection.')
    const config = { version: 1, provider, hostname, enabled: false }
    await privateWrite(this.file, JSON.stringify(config, null, 2) + '\n')
    return config
  }

  async setEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('enabled must be a boolean')
    const config = await this.read()
    if (!config) throw new Error('Set up a permanent phone address first.')
    config.enabled = enabled
    await privateWrite(this.file, JSON.stringify(config, null, 2) + '\n')
    return config
  }

  async prepareTrust() {
    const config = await this.read()
    if (!config?.enabled) return false
    await privateWrite(path.join(this.stateDir, 'trusted-hosts'), `${config.hostname}\n`)
    await privateWrite(path.join(this.stateDir, 'mode'), 'tunnel\n')
    return true
  }
}
