// The human check (Cloudflare Turnstile) in front of "email me a code", through Better Auth's real handler.
import { betterAuth } from 'better-auth'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authOptions } from '../src/api/auth-options.ts'
import type { Db } from '../src/db/client.ts'
import { freshDb, seedChurch, seedMember, seedUser } from './helpers.ts'

const CHURCH = 'org_aaaaaaaaaaaaaaaaaaaaaaaa'
const EMAIL = 'singer@example.com'
const TEST_SECRET = '1x0000000000000000000000000000000AA'
const REAL_SECRET = '0x4AAAAAAAexampleexampleexampleAAAA'
let db: Db
let pg: Awaited<ReturnType<typeof freshDb>>['pg']
let sent: string[]
/** What Cloudflare's siteverify answers next, and what it was asked. */
let verdict: Record<string, unknown>
let asked: { secret?: string; response?: string; remoteip?: string }[]

const makeAuth = (turnstileSecret: string, baseURL = 'http://x.test') =>
  betterAuth(
    authOptions({
      baseURL,
      secret: 'x'.repeat(32),
      db,
      sendCode: (email) => sent.push(email),
      background: () => {},
      turnstileSecret,
    }),
  )
// a different client address each time, so Better Auth's own limit (3 a minute per address) stays out of the way
let client = 0
const askForCode = (auth: ReturnType<typeof makeAuth>, token?: string, baseURL = 'http://x.test') =>
  auth.handler(
    new Request(`${baseURL}/api/auth/email-otp/send-verification-otp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: baseURL, 'cf-connecting-ip': `203.0.113.${++client}`, ...(token ? { 'x-captcha-response': token } : {}) },
      body: JSON.stringify({ email: EMAIL, type: 'sign-in' }),
    }),
  )

beforeEach(async () => {
  ;({ pg, db } = await freshDb())
  sent = []
  asked = []
  verdict = { success: true, action: 'sign-in', hostname: 'example.com' }
  await seedChurch(pg, CHURCH, 'a')
  await seedUser(pg, 'singer', EMAIL)
  await seedMember(pg, CHURCH, 'singer', 'member')
  const realFetch = globalThis.fetch
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString()
    if (!url.startsWith('https://challenges.cloudflare.com/')) return realFetch(input, init)
    asked.push(JSON.parse(String(init?.body ?? '{}')))
    return new Response(JSON.stringify(verdict), { headers: { 'content-type': 'application/json' } })
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('Turnstile before a sign-in code', () => {
  it('sends the code when the check passes, and passes the token, secret and IP to Cloudflare', async () => {
    const res = await askForCode(makeAuth(TEST_SECRET), 'token-1')
    expect(res.status).toBe(200)
    expect(sent).toEqual([EMAIL])
    expect(asked).toEqual([{ secret: TEST_SECRET, response: 'token-1', remoteip: `203.0.113.${client}` }])
  })
  it('refuses without a token, and sends nothing', async () => {
    expect((await askForCode(makeAuth(TEST_SECRET))).status).toBe(400)
    expect(sent).toEqual([])
    expect(asked).toEqual([]) // nothing to verify
  })
  it('refuses a token Cloudflare rejects', async () => {
    verdict = { success: false, 'error-codes': ['invalid-input-response'] }
    expect((await askForCode(makeAuth(TEST_SECRET), 'bad')).status).toBe(403)
    expect(sent).toEqual([])
  })
  it("accepts Cloudflare's test keys, which report no action", async () => {
    verdict = { success: true, hostname: 'example.com' }
    expect((await askForCode(makeAuth(TEST_SECRET), 't')).status).toBe(200)
  })
  it('with a real secret, only accepts the sign-in widget solved on the site itself', async () => {
    const auth = makeAuth(REAL_SECRET, 'https://hub.example.org')
    verdict = { success: true, action: 'sign-in', hostname: 'evil.example.net' }
    expect((await askForCode(auth, 't', 'https://hub.example.org')).status).toBe(403)
    verdict = { success: true, action: 'other', hostname: 'hub.example.org' }
    expect((await askForCode(auth, 't', 'https://hub.example.org')).status).toBe(403)
    verdict = { success: true, hostname: 'hub.example.org' }
    expect((await askForCode(auth, 't', 'https://hub.example.org')).status).toBe(403)
    verdict = { success: true, action: 'sign-in', hostname: 'hub.example.org' }
    expect((await askForCode(auth, 't', 'https://hub.example.org')).status).toBe(200)
    expect(sent).toEqual([EMAIL])
  })
  it('fails closed when the secret is missing', async () => {
    const res = await askForCode(makeAuth(''), 'token')
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(sent).toEqual([])
  })
  it('still limits one address to 3 requests a minute', async () => {
    const auth = makeAuth(TEST_SECRET)
    const same = () =>
      auth.handler(
        new Request('http://x.test/api/auth/email-otp/send-verification-otp', {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'http://x.test', 'cf-connecting-ip': '198.51.100.1', 'x-captcha-response': 't' },
          body: JSON.stringify({ email: EMAIL, type: 'sign-in' }),
        }),
      )
    const statuses = []
    for (let i = 0; i < 4; i++) statuses.push((await same()).status)
    expect(statuses).toEqual([200, 200, 200, 429])
  })
  it('a stranger gets the same answer as a member (who gets mail is decided after this, in src/api/auth.ts)', async () => {
    const auth = makeAuth(TEST_SECRET)
    const stranger = await auth.handler(
      new Request('http://x.test/api/auth/email-otp/send-verification-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://x.test', 'cf-connecting-ip': '203.0.113.8', 'x-captcha-response': 't' },
        body: JSON.stringify({ email: 'stranger@example.com', type: 'sign-in' }),
      }),
    )
    expect(stranger.status).toBe(200)
    expect(await stranger.json()).toEqual({ success: true })
  })
})
