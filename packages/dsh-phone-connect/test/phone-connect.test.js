import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { apply, PhoneConnectController } from '../index.js'

test('the settings namespace validates its own defaults and registers the card API', () => {
  let registeredSchema, registeredValue
  const routes = []
  const ctx = {
    connection: { fetch: { register(value) { routes.push(value) } } },
    effect(fn) { fn() },
    inject(names, fn) {
      assert.deepEqual(names, ['settings'])
      fn({ settings: { installSection(owner, ns, schema, base, hooks) {
        assert.equal(ns, 'phone-connect')
        // Settings.register validates the normalized base a second time.
        registeredSchema = schema
        registeredValue = schema(base)
        hooks.setSource(() => registeredValue)
      } } })
    },
  }
  apply(ctx, { port: 3080, forwardPort: 3081 }) // older installed profile
  assert.equal(registeredValue.stateDir, '')
  assert.deepEqual(registeredSchema(registeredValue), registeredValue)
  assert.deepEqual(
    routes.map((route) => route.path),
    ['/api/phone-connect', '/api/phone-connect/peers', '/api/phone-connect/app'],
  )
  assert.throws(() => registeredSchema({ stateDir: 5 }), /stateDir/)
  assert.throws(() => registeredSchema({ port: 0 }), /port/)
})

async function fixture(t) {
  const stateDir = await mkdtemp(path.join(os.tmpdir(), 'phone-connect-test-'))
  t.after(() => rm(stateDir, { recursive: true, force: true }))
  class Controller extends PhoneConnectController {
    running = false
    restarts = 0
    killed = []
    async managed() { return true }
    async findTool(tool) { return `/test/${tool}` }
    async processRunning(pattern) { return pattern === this.tunnelPattern() && this.running }
    async pkillQuiet(pattern) {
      this.killed.push(pattern)
      if (pattern === this.tunnelPattern()) this.running = false
    }
    applyOptions() {
      super.applyOptions()
      this.permanent = {
        status: async () => this.savedPermanent ?? { configured: false, enabled: false, installed: true, connected: true, active: false },
        enable: async () => {
          if (this.enableError) throw this.enableError
          await writeFile(this.trustedHostsFile, 'mac.example.ts.net\n')
          await writeFile(this.modeFile, 'tunnel\n')
          this.savedPermanent = { configured: true, enabled: true, installed: true, connected: true, active: true, hostname: 'mac.example.ts.net', bookmarkUrl: 'https://mac.example.ts.net/' }
        },
        disable: async () => { this.savedPermanent = { configured: true, enabled: false, active: false } },
      }
    }
    scheduleRestart() { this.restarts++ }
    async qrDataUrl(url) { return `qr:${url}` }
  }
  const controller = new Controller({ authenticatedUrl: () => 'http://127.0.0.1:3080/?token=test-token' },
    () => ({ port: 3080, label: 'local.deepshell', stateDir }))
  await mkdir(controller.runDir)
  return controller
}

function request(mode) {
  return new Request('http://127.0.0.1:3080/api/phone-connect', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }),
  })
}

test('upgrading a stopped temporary tunnel saves the permanent address and produces a tokenized pairing QR', async t => {
  const controller = await fixture(t)
  await writeFile(controller.trustedHostsFile, 'expired-link.trycloudflare.com\n')
  await writeFile(controller.tunnelLog, 'https://expired-link.trycloudflare.com\n')
  await writeFile(controller.modeFile, 'tunnel\n')
  const before = await controller.status()
  assert.equal(before.mode, 'local')
  assert.equal(before.needsCleanup, true)
  assert.equal(before.phoneUrl, null)

  const response = await controller.handle(request('tunnel'))
  assert.equal(response.status, 200)
  assert.equal(await readFile(controller.trustedHostsFile, 'utf8'), 'mac.example.ts.net\n')
  const after = await controller.status()
  assert.equal(after.mode, 'tunnel')
  assert.equal(after.phoneUrl, 'https://mac.example.ts.net/?token=test-token')
  assert.equal(after.qrDataUrl, `qr:${after.phoneUrl}`)
  assert.equal(controller.restarts, 1)
})

test('a running tunnel with a mismatched saved host does not advertise an invalid QR', async t => {
  const controller = await fixture(t)
  controller.running = true
  await writeFile(controller.trustedHostsFile, 'expired-link.trycloudflare.com\n')
  await writeFile(controller.tunnelLog, 'https://fresh-link.trycloudflare.com\n')
  const status = await controller.status()
  assert.equal(status.mode, 'local')
  assert.equal(status.needsCleanup, true)
  assert.equal(status.phoneUrl, null)
})

test('LAN requests are rejected before touching state or restarting', async t => {
  const controller = await fixture(t)
  assert.equal((await controller.handle(request('lan'))).status, 400)
  assert.equal(controller.restarts, 0)
  assert.deepEqual(controller.killed, [])
})

test('turning off clears old LAN/tunnel state and terminates the legacy forwarder', async t => {
  const controller = await fixture(t)
  await writeFile(controller.modeFile, 'lan\n')
  await writeFile(controller.trustedHostsFile, 'expired-link.trycloudflare.com\n')
  assert.equal((await controller.handle(request('local'))).status, 200)
  assert.equal(await readFile(controller.modeFile, 'utf8'), 'local\n')
  await assert.rejects(readFile(controller.trustedHostsFile), { code: 'ENOENT' })
  assert.ok(controller.killed.includes(controller.legacyForwarderPattern()))
  assert.equal((await controller.status()).needsCleanup, false)
})

test('duplicate changes are rejected while a restart is pending', async t => {
  const controller = await fixture(t)
  assert.equal((await controller.handle(request('local'))).status, 200)
  assert.equal((await controller.handle(request('tunnel'))).status, 409)
  assert.equal(controller.restarts, 1)
})

test('a permanent setup error is returned and a later retry is allowed', async t => {
  const controller = await fixture(t)
  controller.enableError = new Error('could not start tunnel')
  const response = await controller.handle(request('tunnel'))
  assert.equal(response.status, 500)
  assert.match((await response.json()).error, /could not start tunnel/)
  assert.equal(controller.restarts, 0)
  assert.equal((await controller.handle(request('local'))).status, 200)
})

test('first-time provider approval is actionable without restarting or exposing unrelated output', async t => {
  const controller = await fixture(t)
  const setupUrl = 'https://login.tailscale.com/f/funnel?node=testNode123'
  controller.enableError = Object.assign(new Error('Approve HTTPS and Funnel in Tailscale.'), { setupUrl })
  const response = await controller.handle(request('tunnel'))
  assert.equal(response.status, 409)
  assert.equal((await response.json()).setupUrl, setupUrl)
  assert.equal(controller.restarts, 0)
  controller.enableError = null
  assert.equal((await controller.handle(request('tunnel'))).status, 200)
})
