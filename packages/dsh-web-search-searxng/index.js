// dsh-web-search-searxng — a Cordis plugin for the DeepSeek Harness that
// registers a SearXNG-backed provider into the ctx.web search seam, so the
// harness's native `web_search` tool runs against a self-hosted SearXNG
// instance instead of a paid/keyed search API.
//
// Provider contract (see @deepseek-ai/dsh-web): an object with
//   id: string
//   available(): boolean
//   search({ query, maxResults }, signal): Promise<{ sources, truncated }>
// where sources are { url, title?, snippet?, publishedAt? } and the seam
// applies the final maxResults cap (so `truncated` is always false here).
//
// The plugin also installs a `web-search-searxng` settings section, so the
// configuration is visible in the harness settings document (and to any
// settings surface) instead of living only in the composition row. Settings
// edits apply live — the provider reads its options through a thunk.
//
// Settings/row config (all optional):
//   baseURL:    SearXNG base, no trailing slash   (default http://127.0.0.1:8888)
//   engines:    comma-separated engine ids        (default: SearXNG's own defaults)
//   language:   search language                   (default: SearXNG's "all")
//   safeSearch: 0 | 1 | 2                         (default: instance setting)

const PROVIDER_ID = 'searxng-local'
const PLUGIN_NAME = 'web-search-searxng'
const SETTINGS_NAMESPACE = 'web-search-searxng'
const DEFAULT_BASE_URL = 'http://127.0.0.1:8888'

// The dsh-settings service drives schemas as plain callables plus toJSON()
// (see dsh-settings: `schema(merged)` resolves a section, `.toJSON()` feeds
// describe). Keeping this dependency-free avoids resolving schemastery from
// a profile-installed package.
const JSON_SCHEMA = {
  type: 'object',
  properties: {
    baseURL: { type: 'string', default: DEFAULT_BASE_URL },
    engines: { type: 'string', default: '' },
    language: { type: 'string', default: '' },
    safeSearch: { type: 'number', enum: [0, 1, 2] },
  },
}

function normalizeConfig(input) {
  if (input === undefined || input === null) return { baseURL: DEFAULT_BASE_URL }
  if (typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${PLUGIN_NAME}: config must be an object`)
  }
  const out = {}
  const baseURL = input.baseURL ?? DEFAULT_BASE_URL
  if (typeof baseURL !== 'string' || !URL.canParse(baseURL)) {
    throw new Error(`${PLUGIN_NAME}: baseURL must be a parseable URL string`)
  }
  out.baseURL = baseURL.replace(/\/+$/, '')
  if (input.engines !== undefined) {
    if (typeof input.engines !== 'string') throw new Error(`${PLUGIN_NAME}: engines must be a comma-separated string`)
    if (input.engines.length > 0) out.engines = input.engines
  }
  if (input.language !== undefined) {
    if (typeof input.language !== 'string') throw new Error(`${PLUGIN_NAME}: language must be a string`)
    if (input.language.length > 0) out.language = input.language
  }
  if (input.safeSearch !== undefined) {
    if (![0, 1, 2].includes(input.safeSearch)) throw new Error(`${PLUGIN_NAME}: safeSearch must be 0, 1, or 2`)
    out.safeSearch = input.safeSearch
  }
  return out
}

function schema(value) {
  return normalizeConfig(value)
}
schema.toJSON = () => JSON_SCHEMA

class SearXNGSearchProvider {
  constructor(resolveOptions) {
    this.resolveOptions = resolveOptions
  }

  get id() {
    return PROVIDER_ID
  }

  available() {
    return URL.canParse(this.resolveOptions().baseURL)
  }

  async search(request, signal) {
    const options = this.resolveOptions()
    const url = new URL('/search', `${options.baseURL}/`)
    url.searchParams.set('q', request.query)
    url.searchParams.set('format', 'json')
    if (options.engines !== undefined) url.searchParams.set('engines', options.engines)
    if (options.language !== undefined) url.searchParams.set('language', options.language)
    if (options.safeSearch !== undefined) url.searchParams.set('safesearch', String(options.safeSearch))

    let response
    try {
      response = await fetch(url, {
        signal,
        headers: { accept: 'application/json' },
      })
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      throw new Error(
        `SearXNG search request failed (${url.host}): ${String(error?.message ?? error)}; ` +
          'is the sidecar running? (deepshell.sh search status)',
        { cause: error },
      )
    }

    if (!response.ok) {
      throw new Error(
        `SearXNG search failed: HTTP ${response.status} from ${url.toString()}; ` +
          'check that formats includes "json" in the instance settings',
      )
    }

    const data = await response.json()
    const results = Array.isArray(data.results) ? data.results : []
    const sources = []
    for (const item of results) {
      if (typeof item.url !== 'string' || item.url.length === 0) continue
      const source = { url: item.url }
      if (typeof item.title === 'string' && item.title.length > 0) source.title = item.title
      if (typeof item.content === 'string' && item.content.length > 0) source.snippet = item.content
      if (typeof item.publishedDate === 'string' && item.publishedDate.length > 0) {
        source.publishedAt = item.publishedDate
      }
      sources.push(source)
    }
    return { sources, truncated: false }
  }
}

export const name = PLUGIN_NAME
export const inject = ['web']

export function apply(ctx, config) {
  // Same pattern as the shipped web-search-deepseek plugin: the provider
  // resolves its options at each search, and the settings section (when the
  // settings service is present) becomes the live source of truth.
  let current = () => normalizeConfig(config)
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, SETTINGS_NAMESPACE, schema, normalizeConfig(config), {
      setSource: (source) => {
        current = () => normalizeConfig(source())
      },
      onChange: () => {},
    })
  })
  ctx.web.registerSearchProvider(new SearXNGSearchProvider(() => current()))
}
