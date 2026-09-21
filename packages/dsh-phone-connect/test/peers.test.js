import assert from 'node:assert/strict'
import test from 'node:test'
import { isUserDevice, machinePresence, parseStatus, probeMachine, stripDot } from '../lib/peers.js'

const device = (overrides = {}) => ({
  HostName: 'mac-studio',
  DNSName: 'mac-studio.tail82d764.ts.net.',
  OS: 'macos',
  Online: true,
  ...overrides,
})

test('user-device filter keeps real machines and drops Tailscale infrastructure', () => {
  assert.equal(isUserDevice(device()), true)
  assert.equal(isUserDevice(device({ HostName: 'funnel-ingress-node', DNSName: '', OS: '' })), false)
  assert.equal(isUserDevice(device({ DNSName: '' })), false)
  assert.equal(isUserDevice(device({ OS: '' })), false)
  assert.equal(isUserDevice({}), false)
})

test('parseStatus strips the trailing dot, sorts online first, and reports self', () => {
  const parsed = parseStatus({
    Self: { DNSName: 'macbook-pro.tail82d764.ts.net.' },
    Peer: {
      a: device({ HostName: 'z-offline-mac', DNSName: 'z-offline-mac.tail82d764.ts.net.', Online: false }),
      b: device({ HostName: 'funnel-ingress-node', DNSName: '', OS: '' }),
      c: device({ HostName: 'mac-studio', DNSName: 'mac-studio.tail82d764.ts.net.', Online: true }),
      d: device({ HostName: 'a-windows-pc', DNSName: 'a-windows-pc.tail82d764.ts.net.', OS: 'windows', Online: true }),
    },
  })
  assert.equal(parsed.selfHost, 'macbook-pro.tail82d764.ts.net')
  assert.deepEqual(
    parsed.machines.map((machine) => machine.name),
    ['a-windows-pc', 'mac-studio', 'z-offline-mac'],
  )
  assert.deepEqual(
    parsed.machines.map((machine) => machine.online),
    [true, true, false],
  )
})

test('stripDot removes only the trailing root dot', () => {
  assert.equal(stripDot('mac.ts.net.'), 'mac.ts.net')
  assert.equal(stripDot('mac.ts.net'), 'mac.ts.net')
})

test('probeMachine treats ANY HTTP answer as serving, including fence rejections', async () => {
  const serving = await probeMachine('mac.ts.net', {
    fetchImpl: async () => new Response('unauthorized', { status: 401 }),
  })
  assert.equal(serving, true)
})

test('probeMachine treats network errors and timeouts as offline', async () => {
  const offline = await probeMachine('mac.ts.net', {
    fetchImpl: async () => {
      throw new Error('connect ETIMEDOUT')
    },
  })
  assert.equal(offline, false)
})

test('machinePresence maps tailnet state plus probes to presence levels', async () => {
  const run = async () =>
    JSON.stringify({
      Self: { DNSName: 'macbook-pro.tail82d764.ts.net.' },
      Peer: {
        a: device({ HostName: 'up-mac', DNSName: 'up-mac.tail82d764.ts.net.', Online: true }),
        b: device({ HostName: 'harness-down-mac', DNSName: 'harness-down-mac.tail82d764.ts.net.', Online: true }),
        c: device({ HostName: 'off-mac', DNSName: 'off-mac.tail82d764.ts.net.', Online: false }),
      },
    })
  const fetchImpl = async (url) => {
    if (url.includes('up-mac.')) return new Response('unauthorized', { status: 401 })
    throw new Error('connect ECONNREFUSED')
  }
  const presence = await machinePresence({ run, fetchImpl })
  assert.equal(presence.tailscale, true)
  assert.equal(presence.selfHost, 'macbook-pro.tail82d764.ts.net')
  const byName = Object.fromEntries(presence.machines.map((machine) => [machine.name, machine.presence]))
  assert.deepEqual(byName, { 'up-mac': 'online', 'harness-down-mac': 'away', 'off-mac': 'offline' })
})

test('machinePresence degrades to an empty list when Tailscale is unavailable', async () => {
  const presence = await machinePresence({
    run: async () => {
      throw new Error('tailscaled not running')
    },
  })
  assert.equal(presence.tailscale, false)
  assert.deepEqual(presence.machines, [])
})
