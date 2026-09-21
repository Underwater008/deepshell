// dsh-video-qa-moonshot — a Cordis plugin for the DeepSeek Harness that
// registers a `video_qa` tool: ask questions about a local video file through
// a video-capable Kimi model (kimi-k3, kimi-k2.6, kimi-k2.7-code).
//
// The engine's own modality seam is text/image today, so this tool bridges
// the gap provider-side: the video goes straight to the OpenAI-compatible
// endpoint and the model's answer comes back as ordinary tool text.
//
// Two transports:
//   moonshot-files  Upload via POST {baseURL}/files (purpose=video), then
//                   reference `ms://<file-id>` in a `video_url` part — the
//                   documented flow for api.moonshot.ai / api.moonshot.cn.
//                   The uploaded file is deleted best-effort afterwards.
//   video-url       Inline the video as a base64 data URL in a `video_url`
//                   part — what vLLM-family OpenAI-compatible servers
//                   (RunPod, Modal, self-hosted) accept for video models.
// `transport: "auto"` (default) picks moonshot-files when the baseURL names a
// Moonshot host, video-url otherwise.
//
// Row config (all optional):
//   baseURL:    OpenAI-compatible base, no trailing slash (default https://api.moonshot.ai/v1)
//   apiKeyEnv:  credential reference resolved per call         (default MOONSHOT_API_KEY)
//   model:      video-capable model id                         (default kimi-k3)
//   transport:  auto | moonshot-files | video-url              (default auto)
//   maxVideoMB: video size cap in MiB                          (default 90; video-url clamps to 20)
//   timeoutMs:  cooperative tool-call budget in ms             (default 600000)
//
// Credentials resolve per call through ctx.credentials, falling back to the
// harness process environment — same chain as the official search providers.

import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

export const name = 'video-qa-moonshot'
export const inject = ['tools']

const DEFAULT_BASE_URL = 'https://api.moonshot.ai/v1'
const DEFAULT_API_KEY_ENV = 'MOONSHOT_API_KEY'
const DEFAULT_MODEL = 'kimi-k3'
const DEFAULT_TIMEOUT_MS = 600000
const DEFAULT_MAX_VIDEO_MB = 90
const VIDEO_URL_MAX_MB = 20

const MIME_BY_EXT = new Map([
  ['.mp4', 'video/mp4'],
  ['.mpeg', 'video/mpeg'],
  ['.mpg', 'video/mpg'],
  ['.mov', 'video/mov'],
  ['.avi', 'video/avi'],
  ['.flv', 'video/x-flv'],
  ['.webm', 'video/webm'],
  ['.wmv', 'video/wmv'],
  ['.3gp', 'video/3gpp'],
  ['.3gpp', 'video/3gpp'],
])

function resolveTransport(transport, baseURL) {
  if (transport === 'moonshot-files' || transport === 'video-url') return transport
  if (transport !== undefined && transport !== 'auto') {
    throw new Error(`unknown transport "${transport}" (expected auto | moonshot-files | video-url)`)
  }
  return /(^|\.)moonshot\.(ai|cn)(\/|:|$)/.test(baseURL) ? 'moonshot-files' : 'video-url'
}

function mimeFromPath(videoPath) {
  const mime = MIME_BY_EXT.get(path.extname(videoPath).toLowerCase())
  if (mime === undefined) {
    throw new Error(
      `unsupported video type "${path.extname(videoPath)}"; ` +
        `supported: ${[...MIME_BY_EXT.keys()].join(', ')}`,
    )
  }
  return mime
}

async function readVideo(videoPath, capBytes) {
  if (typeof videoPath !== 'string' || videoPath.length === 0) {
    throw new Error('path must be a non-empty absolute path to a local video file')
  }
  if (!path.isAbsolute(videoPath)) {
    throw new Error(`path must be absolute, got "${videoPath}"`)
  }
  const info = await stat(videoPath).catch(() => {
    throw new Error(`no readable file at ${videoPath}`)
  })
  if (!info.isFile()) throw new Error(`${videoPath} is not a regular file`)
  if (info.size === 0) throw new Error(`${videoPath} is empty`)
  if (info.size > capBytes) {
    throw new Error(
      `${videoPath} is ${(info.size / 2 ** 20).toFixed(1)} MiB, over the ` +
        `${(capBytes / 2 ** 20).toFixed(0)} MiB cap for this transport; trim or compress it first`,
    )
  }
  return readFile(videoPath)
}

function extractAnswer(data) {
  const content = data?.choices?.[0]?.message?.content
  if (typeof content === 'string' && content.length > 0) return content
  if (Array.isArray(content)) {
    const text = content
      .filter((part) => part?.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text)
      .join('\n')
    if (text.length > 0) return text
  }
  throw new Error(`endpoint returned no text answer: ${JSON.stringify(data).slice(0, 400)}`)
}

async function postChat(baseURL, apiKey, model, contentParts, signal) {
  const response = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    signal,
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [{ role: 'user', content: contentParts }],
    }),
  })
  if (!response.ok) {
    const body = (await response.text().catch(() => '')).slice(0, 400)
    throw new Error(`chat completion failed: HTTP ${response.status} from ${baseURL} — ${body}`)
  }
  return response.json()
}

async function askViaMoonshotFiles({ baseURL, apiKey, model, question, videoPath, mime, buffer, signal }) {
  const form = new FormData()
  form.set('purpose', 'video')
  form.set('file', new Blob([buffer], { type: mime }), path.basename(videoPath))
  const upload = await fetch(`${baseURL}/files`, {
    method: 'POST',
    signal,
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  })
  if (!upload.ok) {
    const body = (await upload.text().catch(() => '')).slice(0, 400)
    throw new Error(`video upload failed: HTTP ${upload.status} from ${baseURL} — ${body}`)
  }
  const file = await upload.json()
  if (typeof file?.id !== 'string' || file.id.length === 0) {
    throw new Error(`upload returned no file id: ${JSON.stringify(file).slice(0, 400)}`)
  }
  try {
    const data = await postChat(
      baseURL,
      apiKey,
      model,
      [
        { type: 'video_url', video_url: { url: `ms://${file.id}` } },
        { type: 'text', text: question },
      ],
      signal,
    )
    return { answer: extractAnswer(data), fileId: file.id }
  } finally {
    // Best-effort cleanup: the file was uploaded only to serve this one call.
    fetch(`${baseURL}/files/${file.id}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${apiKey}` },
    }).catch(() => {})
  }
}

async function askViaVideoUrl({ baseURL, apiKey, model, question, mime, buffer, signal }) {
  const dataURL = `data:${mime};base64,${buffer.toString('base64')}`
  const data = await postChat(
    baseURL,
    apiKey,
    model,
    [
      { type: 'video_url', video_url: { url: dataURL } },
      { type: 'text', text: question },
    ],
    signal,
  )
  return { answer: extractAnswer(data) }
}

export function apply(ctx, config) {
  const cfg = config ?? {}
  const baseURL = String(cfg.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const apiKeyEnv = cfg.apiKeyEnv ?? DEFAULT_API_KEY_ENV
  const defaultModel = cfg.model ?? DEFAULT_MODEL
  const transport = resolveTransport(cfg.transport ?? 'auto', baseURL)
  const timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxVideoMB =
    transport === 'video-url'
      ? Math.min(cfg.maxVideoMB ?? DEFAULT_MAX_VIDEO_MB, VIDEO_URL_MAX_MB)
      : (cfg.maxVideoMB ?? DEFAULT_MAX_VIDEO_MB)
  const capBytes = maxVideoMB * 2 ** 20

  async function resolveApiKey() {
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) return (await credentials.resolve(apiKeyEnv))?.value
    const ambient = process.env[apiKeyEnv]
    return typeof ambient === 'string' && ambient.length > 0 ? ambient : undefined
  }

  ctx.tools.register({
    name: 'video_qa',
    description:
      'Analyze a local video file with a video-capable Kimi model and answer a question about it: ' +
      'summarize what happens, transcribe speech, describe scenes, find a moment. ' +
      'Takes an absolute path to the video (mp4, mpeg, mov, avi, flv, webm, wmv, 3gpp). ' +
      'The video is uploaded to the configured OpenAI-compatible endpoint for this one call; ' +
      'the answer comes back as text.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['path', 'question'],
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path to a local video file.',
        },
        question: {
          type: 'string',
          description: 'What to ask about the video, e.g. "Summarize what happens" or "Transcribe the audio".',
        },
        model: {
          type: 'string',
          description: `Optional model override (default: ${defaultModel}).`,
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['answer', 'model', 'transport'],
        properties: {
          answer: { type: 'string' },
          model: { type: 'string' },
          transport: { type: 'string' },
          fileId: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.answer }],
    },
    timeoutMs,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const videoPath = args?.path
      const question = args?.question
      if (typeof question !== 'string' || question.length === 0) {
        throw new Error('question must be a non-empty string')
      }
      const model = typeof args?.model === 'string' && args.model.length > 0 ? args.model : defaultModel
      const mime = mimeFromPath(videoPath)
      const apiKey = await resolveApiKey()
      if (typeof apiKey !== 'string' || apiKey.length === 0) {
        throw new Error(
          `video_qa has no API key for "${apiKeyEnv}"; store it through the credentials ` +
            'service or export it in the harness environment',
        )
      }
      const buffer = await readVideo(videoPath, capBytes)
      const shared = { baseURL, apiKey, model, question, videoPath, mime, buffer, signal: exec.signal }
      const result =
        transport === 'moonshot-files' ? await askViaMoonshotFiles(shared) : await askViaVideoUrl(shared)
      return {
        answer: result.answer,
        model,
        transport,
        ...(result.fileId !== undefined ? { fileId: result.fileId } : {}),
      }
    },
  })
}
