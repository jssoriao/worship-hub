// Which Better Auth requests go through its rate limiter (stored in rate_limits, two round trips each).
import { betterAuth } from 'better-auth'
import { beforeEach, describe, expect, it } from 'vitest'
import { authOptions, UNLIMITED_READS } from '../src/api/auth-options.ts'
import type { Db } from '../src/db/client.ts'
import { freshDb } from './helpers.ts'
let db: Db
let pg: Awaited<ReturnType<typeof freshDb>>['pg']
const auth = () =>
  betterAuth(authOptions({ baseURL: 'http://x.test', secret: 'x'.repeat(32), db, sendCode: () => {}, background: () => {}, turnstileSecret: '' }))
const request = (path: string, method = 'GET') =>
  new Request(`http://x.test/api/auth${path}`, {
    method,
    headers: { 'content-type': 'application/json', origin: 'http://x.test', 'cf-connecting-ip': '198.51.100.7' },
    body: method === 'POST' ? JSON.stringify({ email: 'nobody@example.com', type: 'sign-in' }) : undefined,
  })
const counted = async () => (await pg.query<{ key: string }>('select key from rate_limits')).rows.map((r) => r.key)
beforeEach(async () => {
  ;({ pg, db } = await freshDb())
})
describe('auth rate limit', () => {
  it('skips reads of the session and its churches', async () => {
    const a = auth()
    for (const path of UNLIMITED_READS) await a.handler(request(path))
    expect(await counted()).toEqual([])
  })
  it('still counts asking for a sign-in code', async () => {
    await auth().handler(request('/email-otp/send-verification-otp', 'POST'))
    expect((await counted()).some((key) => key.includes('/email-otp/send-verification-otp'))).toBe(true)
  })
})
