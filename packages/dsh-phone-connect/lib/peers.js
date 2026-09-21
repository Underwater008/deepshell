// Tailnet machine registry + presence probing for the Remote switchboard.
//
// The tailnet is the multi-machine substrate: `tailscale status --json` is
// the machine registry (peers + Online state + MagicDNS names), and an HTTPS
// probe against each peer's Funnel address is the harness-presence check.
// Both sides are injectable so tests need no Tailscale and no network.

import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'

const APP_CLI = '/Applications/Tailscale.app/Contents/MacOS/Tailscale'
const CLI_CANDIDATES = [APP_CLI, '/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale']
const INFRA_HOSTNAMES = new Set(['funnel-ingress-node'])

function defaultRun(binary, args) {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error)
      else resolve(String(stdout))
    })
  })
}

async function findBinary() {
  for (const binary of CLI_CANDIDATES) {
    try {
      await access(binary, constants.X_OK)
      return binary
    } catch {}
  }
  return null
}

// A "user device" peer: has a MagicDNS name and a real OS. Tailscale's own
// infrastructure (Funnel ingress nodes visible on funnel-enabled tailnets)
// has neither and is filtered out.
export function isUserDevice(peer) {
  return (
    typeof peer?.DNSName === 'string' &&
    peer.DNSName.length > 0 &&
    typeof peer?.HostName === 'string' &&
    !INFRA_HOSTNAMES.has(peer.HostName) &&
    Boolean(peer?.OS)
  )
}

export function stripDot(hostname) {
  return hostname.replace(/\.$/, '')
}

// Parse `tailscale status --json` into the switchboard's machine list.
// Self is reported separately; peers become { name, host, online } rows,
// sorted with online machines first, then alphabetically.
export function parseStatus(status) {
  const selfHost = typeof status?.Self?.DNSName === 'string' ? stripDot(status.Self.DNSName) : null
  const machines = []
  for (const peer of Object.values(status?.Peer ?? {})) {
    if (!isUserDevice(peer)) continue
    machines.push({
      name: peer.HostName,
      host: stripDot(peer.DNSName),
      online: peer.Online === true,
    })
  }
  machines.sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))
  return { selfHost, machines }
}

export async function listMachines({ run = defaultRun } = {}) {
  const binary = await findBinary()
  if (binary === null) return { selfHost: null, machines: [], tailscale: false }
  try {
    const parsed = JSON.parse(await run(binary, ['status', '--json']))
    return { ...parseStatus(parsed), tailscale: true }
  } catch {
    return { selfHost: null, machines: [], tailscale: false }
  }
}

// Presence probe: ANY HTTP response (401/403 included — the trust fence
// answers before auth) means the harness is serving; a network error or
// timeout means the machine or its Funnel is down.
export async function probeMachine(host, { fetchImpl = fetch, timeoutMs = 3500 } = {}) {
  try {
    await fetchImpl(`https://${host}/api/phone-connect`, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
    return true
  } catch {
    return false
  }
}

// Full presence snapshot: tailnet registry joined with per-machine probes.
// presence: 'online' (harness serving) | 'away' (machine up, harness/funnel
// down) | 'offline' (tailnet-down).
export async function machinePresence({ run, fetchImpl, timeoutMs } = {}) {
  const { selfHost, machines, tailscale } = await listMachines({ run })
  const probed = await Promise.all(
    machines.map(async (machine) => {
      if (!machine.online) return { ...machine, presence: 'offline' }
      const serving = await probeMachine(machine.host, { fetchImpl, timeoutMs })
      return { ...machine, presence: serving ? 'online' : 'away' }
    }),
  )
  return { selfHost, machines: probed, tailscale }
}
