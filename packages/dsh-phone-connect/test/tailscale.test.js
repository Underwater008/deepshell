import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { TailscaleConnection, funnelSetupUrl } from '../lib/tailscale.js'

test('first-time approval extracts only the trusted Funnel setup URL', () => {
  const url = 'https://login.tailscale.com/f/funnel?node=testNode123'
  assert.equal(funnelSetupUrl(`Funnel is not enabled.\nTo enable, visit:\n\n ${url}\n`), url)
  for (const output of [
    'https://login.tailscale.com.evil.example/f/funnel?node=test',
    'https://evil.example/f/funnel?node=test',
    'https://login.tailscale.com/a/private-auth-token',
    `${url}&redirect=https://evil.example`,
  ]) assert.equal(funnelSetupUrl(output), null)
})

const hostname = 'mac.example.ts.net'
const route = (hostname = 'mac.example.ts.net') => ({
  TCP: { '443': { HTTPS: true } },
  Web: { [`${hostname}:443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:3080' } } } },
  AllowFunnel: { [`${hostname}:443`]: true },
})
async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'phone-tailscale-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const system = { connected: true, hostname, serve: {}, commands: [] }
  const run = async (_, args) => {
    system.commands.push(args)
    if (args[0] === 'status') return JSON.stringify({ BackendState: system.connected ? 'Running' : 'NeedsLogin', Self: { DNSName: system.hostname + '.', Online: system.connected } })
    if (args[1] === 'status') return JSON.stringify(system.serve)
    if (args.includes('off')) { system.serve = {}; return '' }
    system.serve = route(system.hostname)
    return ''
  }
  const make = () => {
    const connection = new TailscaleConnection({ stateDir: directory, run })
    connection.binary = async () => '/test/tailscale'
    return connection
  }
  return { system, make, connection: make() }
}

test('separate installations use their own device addresses and require explicit setup', async t => {
  const first = await fixture(t)
  const second = await fixture(t)
  first.system.hostname = 'alice.personal-one.ts.net'
  second.system.hostname = 'bob.personal-two.ts.net'

  assert.equal(await first.connection.enable(), 'https://alice.personal-one.ts.net/')
  assert.equal(await second.connection.resume(), false)
  assert.equal(await second.connection.state.read(), null)
  assert.deepEqual(second.system.commands, [])

  assert.equal(await second.connection.enable(), 'https://bob.personal-two.ts.net/')
  await first.connection.disable()
  const secondStatus = await second.make().status()
  assert.equal(secondStatus.active, true)
  assert.equal(secondStatus.bookmarkUrl, 'https://bob.personal-two.ts.net/')
})

test('persistent browser-only access resumes at the same address after full app shutdown', async t => {
  const { system, connection, make } = await fixture(t)
  assert.equal(await connection.enable(), `https://${hostname}/`)
  assert.equal((await connection.status()).active, true)
  assert.ok(system.commands.some(args => args.includes('--bg')))
  await connection.suspend()
  assert.equal((await connection.state.read()).enabled, true)
  assert.deepEqual(system.serve, {})
  const restarted = make()
  assert.equal(await restarted.resume(), true)
  assert.equal((await restarted.status()).bookmarkUrl, `https://${hostname}/`)
  assert.equal((await restarted.status()).active, true)
})

test('turn off persists and never silently re-enables after startup', async t => {
  const { connection, make, system } = await fixture(t)
  await connection.enable()
  await connection.disable()
  const calls = system.commands.length
  assert.equal(await make().resume(), false)
  assert.equal(system.commands.length, calls)
  assert.deepEqual(system.serve, {})
})

test('a later network connection allows recovery without changing the bookmark', async t => {
  const { connection, system } = await fixture(t)
  await connection.enable()
  await connection.suspend()
  system.connected = false
  await assert.rejects(connection.resume(), /sign in/)
  assert.equal((await connection.state.read()).enabled, true)
  system.connected = true
  assert.equal(await connection.resume(), true)
  assert.equal((await connection.status()).bookmarkUrl, `https://${hostname}/`)
})

test('setup refuses to overwrite another app sharing HTTPS port 443', async t => {
  const { system, connection } = await fixture(t)
  system.serve = route()
  system.serve.Web[`${hostname}:443`].Handlers['/'].Proxy = 'http://127.0.0.1:9000'
  const before = structuredClone(system.serve)
  await assert.rejects(connection.enable(), /another app/)
  assert.deepEqual(system.serve, before)
  assert.equal((await connection.state.read()).enabled, false)
})

test('shutdown preserves an externally replaced listener', async t => {
  const { system, connection } = await fixture(t)
  await connection.enable()
  system.serve.Web[`${hostname}:443`].Handlers['/other'] = { Proxy: 'http://127.0.0.1:9000' }
  const before = structuredClone(system.serve)
  await connection.suspend()
  assert.deepEqual(system.serve, before)
})

test('a renamed device cannot silently invalidate the stored phone address', async t => {
  const { system, connection } = await fixture(t)
  await connection.enable()
  system.hostname = 'other.example.ts.net'
  await assert.rejects(connection.resume(), /address changed/)
  assert.equal((await connection.state.read()).hostname, hostname)
})

test('unavailable Tailscale cannot falsely report a successful turn-off', async t => {
  const { system, connection } = await fixture(t)
  await connection.enable()
  system.connected = false
  await assert.rejects(connection.disable(), /Reconnect Tailscale/)
  assert.equal((await connection.state.read()).enabled, true)
})
