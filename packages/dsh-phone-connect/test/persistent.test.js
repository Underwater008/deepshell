import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { ConnectionState, normalizeHostname } from '../lib/persistent.js'

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'phone-persistent-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return { directory, state: new ConnectionState(directory) }
}

test('an enabled permanent address survives a new process and rebuilds startup trust', async t => {
  const { directory, state } = await fixture(t)
  await state.configure('tailscale-funnel', 'https://mac.example.ts.net/')
  await state.setEnabled(true)
  const restarted = new ConnectionState(directory)
  assert.equal((await restarted.read()).enabled, true)
  assert.equal(await restarted.prepareTrust(), true)
  assert.equal(await readFile(path.join(directory, 'trusted-hosts'), 'utf8'), 'mac.example.ts.net\n')
  assert.equal((await stat(state.file)).mode & 0o777, 0o600)
})

test('turning remote access off stays off through restart', async t => {
  const { directory, state } = await fixture(t)
  await state.configure('tailscale-funnel', 'device.example.ts.net')
  await state.setEnabled(true)
  await state.setEnabled(false)
  const restarted = new ConnectionState(directory)
  assert.equal(await restarted.prepareTrust(), false)
  assert.equal((await restarted.read()).hostname, 'device.example.ts.net')
  await assert.rejects(readFile(path.join(directory, 'trusted-hosts')), { code: 'ENOENT' })
})

test('temporary URLs and URL credentials cannot become permanent host trust', () => {
  for (const input of ['https://old.trycloudflare.com', 'http://example.com', 'user:secret@example.com',
    'example.com/path', 'example.com:3080', 'example.com?token=secret', 'localhost', '127.0.0.1', 'example.com\nother.com']) {
    assert.throws(() => normalizeHostname(input))
  }
})

test('corrupt saved state fails closed instead of silently enabling a temporary tunnel', async t => {
  const { state } = await fixture(t)
  await state.configure('tailscale-funnel', 'device.example.ts.net')
  await writeFile(state.file, '{"version":1,"provider":"unexpected","enabled":true}')
  await assert.rejects(state.prepareTrust(), /invalid/)
})

test('an active permanent connection cannot be silently reassigned', async t => {
  const { state } = await fixture(t)
  await state.configure('tailscale-funnel', 'device.example.ts.net')
  await state.setEnabled(true)
  await assert.rejects(state.configure('tailscale-funnel', 'different.example.ts.net'), /Turn off/)
  assert.equal((await state.read()).hostname, 'device.example.ts.net')
})
