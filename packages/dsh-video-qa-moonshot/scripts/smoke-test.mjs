#!/usr/bin/env node
// smoke-test.mjs — run the real video_qa tool definition against a live
// endpoint, without the harness. Loads apply() from ../index.js with a fake
// ctx, captures the registered tool, and executes it.
//
// Usage:
//   node scripts/smoke-test.mjs --path /tmp/clip.mp4 [--question "..."] \
//     [--base-url https://api.runpod.ai/v2/moonshot-kimi/openai/v1] \
//     [--key-env RUNPOD_API_KEY] [--model kimi-k3] [--transport auto]
//
// Keys resolve from the process environment first, then from the refs section
// of ~/.dsh/.credentials.yaml (values are never printed).

import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { apply } from '../index.js'

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const videoPath = arg('--path', undefined)
const question = arg('--question', 'Describe what happens in this video in one or two sentences.')
const baseURL = arg('--base-url', 'https://api.runpod.ai/v2/moonshot-kimi/openai/v1')
const keyEnv = arg('--key-env', 'RUNPOD_API_KEY')
const model = arg('--model', 'kimi-k3')
const transport = arg('--transport', 'auto')

if (!videoPath) {
  console.error('usage: node scripts/smoke-test.mjs --path /tmp/clip.mp4 [--question "..."] [--base-url ...] [--key-env ...] [--model ...] [--transport auto|moonshot-files|video-url]')
  process.exit(2)
}

async function readCredentialRef(name) {
  if (process.env[name]) return
  const file = path.join(os.homedir(), '.dsh', '.credentials.yaml')
  const text = await readFile(file, 'utf8').catch(() => undefined)
  if (!text) return
  const match = text.match(new RegExp(`^\\s{2}${name}:\\s*(\\S+)\\s*$`, 'm'))
  if (match) process.env[name] = match[1]
}

await readCredentialRef(keyEnv)

let tool
const fakeCtx = {
  get: () => undefined, // no credentials service: plugin falls back to process.env
  tools: {
    register(definition) {
      tool = definition
    },
  },
}

apply(fakeCtx, { baseURL, apiKeyEnv: keyEnv, model, transport })
if (!tool) {
  console.error('plugin did not register a tool')
  process.exit(1)
}

console.log(`tool: ${tool.name}  endpoint: ${baseURL}  model: ${model}  key: ${keyEnv}${process.env[keyEnv] ? ' (resolved)' : ' (MISSING)'}`)
const started = Date.now()
try {
  const result = await tool.execute(
    { path: videoPath, question },
    { signal: AbortSignal.timeout(300000) },
  )
  console.log(`transport: ${result.transport}  (${((Date.now() - started) / 1000).toFixed(1)}s)`)
  console.log('--- answer ---')
  console.log(result.answer)
} catch (error) {
  console.error(`FAILED after ${((Date.now() - started) / 1000).toFixed(1)}s: ${error.message}`)
  process.exit(1)
}
