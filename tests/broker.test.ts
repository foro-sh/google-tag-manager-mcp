import { describe, expect, it } from 'vitest'
import { BrokerTokens } from '../broker.ts'

function broker(responses: Array<{ status: number; body: unknown }>, now = () => 0) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = []
  const fetch = (async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, headers: init.headers })
    const { status, body } = responses.shift()!
    return new Response(JSON.stringify(body), { status })
  }) as unknown as typeof globalThis.fetch
  return { tokens: new BrokerTokens({ url: 'http://broker', token: 'cap', fetch, now }), calls }
}

const caller = (handle: string, subject: string) => new Headers({ 'x-foro-caller': handle, 'x-foro-subject': subject })

describe('BrokerTokens', () => {
  it('asks for the google grant as the caller and caches per subject', async () => {
    const { tokens, calls } = broker([
      { status: 200, body: { access_token: 'a', expires_at: '1970-01-01T01:00:00Z' } },
      { status: 200, body: { access_token: 'b', expires_at: '1970-01-01T01:00:00Z' } },
    ])
    expect(await tokens.forRequest(caller('h1', 'alice')).getAccessToken()).toBe('a')
    expect(await tokens.forRequest(caller('h2', 'alice')).getAccessToken()).toBe('a')
    expect(await tokens.forRequest(caller('h3', 'bob')).getAccessToken()).toBe('b')
    expect(calls).toEqual([
      { url: 'http://broker/grants/google', headers: { Authorization: 'Bearer cap', 'x-foro-caller': 'h1' } },
      { url: 'http://broker/grants/google', headers: { Authorization: 'Bearer cap', 'x-foro-caller': 'h3' } },
    ])
  })

  it('fetches again once the token expires', async () => {
    let now = 0
    const { tokens, calls } = broker(
      [
        { status: 200, body: { access_token: 'a', expires_at: '1970-01-01T00:00:01Z' } },
        { status: 200, body: { access_token: 'b', expires_at: '1970-01-01T01:00:00Z' } },
      ],
      () => now,
    )
    const auth = tokens.forRequest(new Headers())
    expect(await auth.getAccessToken()).toBe('a')
    now = 1000
    expect(await auth.getAccessToken()).toBe('b')
    expect(calls[0].headers).toEqual({ Authorization: 'Bearer cap' })
  })

  it('sends a caller with no grant to the sign-in link', async () => {
    const { tokens } = broker([{ status: 404, body: { error: 'not_connected', connect_url: 'https://foro.sh/x' } }])
    await expect(tokens.forRequest(caller('h', 's')).getAccessToken()).rejects.toThrow('Sign in to Google at https://foro.sh/x')
  })
})
