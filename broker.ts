import type { GtmAuthProvider } from 'google-tag-manager-mcp-core'

// Google access tokens from foro's upstream broker. foro holds the refresh token
// and foro's own Google client; neither ever reaches this container.
//
// With a per-user grant, foro's gate adds `x-foro-caller` (a short-lived handle
// the broker resolves to the caller) and `x-foro-subject` to each request and
// strips any a client sent. Tokens are cached per subject, since the handle
// rotates; without a handle there is one shared token.

/** The upstream grant's name on the foro project. */
export const GRANT_NAME = 'google'
// A team is small; past this the least recently used caller's token is fetched again.
const MAX_CALLERS = 256

export interface BrokerConfig {
  url: string
  token: string
  fetch?: typeof fetch
  now?: () => number
}

export function brokerConfigFromEnv(env: NodeJS.ProcessEnv = process.env): BrokerConfig {
  const url = env.FORO_UPSTREAM_BROKER_URL
  const token = env.FORO_UPSTREAM_BROKER_TOKEN
  if (!url || !token) {
    throw new Error(
      'This server gets its Google tokens from foro’s upstream broker, which only exists inside a foro deploy. ' +
        'Missing FORO_UPSTREAM_BROKER_URL or FORO_UPSTREAM_BROKER_TOKEN.',
    )
  }
  return { url: url.replace(/\/+$/, ''), token }
}

export class BrokerTokens {
  readonly #cache = new Map<string | null, { token: string; expiresAt: number }>()
  readonly #config: Required<BrokerConfig>

  constructor(config: BrokerConfig) {
    this.#config = { fetch: globalThis.fetch, now: Date.now, ...config }
  }

  /** The auth provider for one request, from the headers foro's gate set on it. */
  forRequest(headers: Headers): GtmAuthProvider {
    const handle = headers.get('x-foro-caller')
    const key = handle ? headers.get('x-foro-subject') || handle : null
    return { getAccessToken: () => this.#accessToken(handle, key) }
  }

  async #accessToken(handle: string | null, key: string | null): Promise<string> {
    const cached = this.#cache.get(key)
    // The broker already hands out expiry early, so a token is good right up to expires_at.
    if (cached && cached.expiresAt > this.#config.now()) return cached.token
    const fresh = await this.#fetch(handle)
    this.#cache.delete(key)
    this.#cache.set(key, fresh)
    if (this.#cache.size > MAX_CALLERS) this.#cache.delete(this.#cache.keys().next().value!)
    return fresh.token
  }

  async #fetch(handle: string | null): Promise<{ token: string; expiresAt: number }> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.#config.token}` }
    if (handle) headers['x-foro-caller'] = handle
    const res = await this.#config.fetch(`${this.#config.url}/grants/${GRANT_NAME}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    })
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) throw new Error(brokerError(res.status, body))
    if (typeof body.access_token !== 'string') throw new Error('foro’s broker returned no Google access token.')
    const expiresAt = typeof body.expires_at === 'string' ? Date.parse(body.expires_at) : Number.POSITIVE_INFINITY
    return { token: body.access_token, expiresAt }
  }
}

function brokerError(status: number, body: Record<string, unknown>): string {
  const connect = typeof body.connect_url === 'string' ? body.connect_url : null
  if (status === 401 && body.error === 'caller_required') return 'foro could not tell who is calling; try again.'
  if (status === 404 && connect) {
    return `You have not connected Google Tag Manager yet. Sign in to Google at ${connect}, then try again.`
  }
  if (status === 404) {
    return 'Google Tag Manager is not connected yet: sign in to Google from the project’s Environment tab on foro.'
  }
  if (status === 409 && connect) {
    return `Your Google connection has lapsed. Sign in to Google again at ${connect}, then try again.`
  }
  if (status === 409) return 'The Google connection has lapsed. Reconnect it from the project’s Environment tab on foro.'
  return `foro could not get a Google access token (${status}); try again shortly.`
}
