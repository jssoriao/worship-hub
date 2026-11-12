import { createApp } from '../src/api/app.ts'
import type { Memo } from '../src/api/data.ts'
import type { SessionSource } from '../src/api/tenant.ts'
import type { Db } from '../src/db/client.ts'
/**
 * Sessions are faked: the "cookie" header is `user=<id>; church=<id|none>`. Ending it with ` refresh`
 * makes the session check hand back a refreshed cookie, as Better Auth does.
 */
export const fakeAuth: SessionSource = {
  api: {
    async getSession({ headers }) {
      const cookie = headers.get('cookie') ?? ''
      const m = /user=([^;]+); church=(\S+)/.exec(cookie)
      if (!m) return { headers: new Headers(), response: null }
      const out = new Headers()
      if (cookie.endsWith(' refresh')) out.append('Set-Cookie', 'session=refreshed; Path=/')
      return {
        headers: out,
        response: { session: { activeOrganizationId: m[2] === 'none' ? null : m[2] }, user: { id: m[1], name: m[1], email: `${m[1]}@example.com` } },
      }
    },
  },
}
const noCtx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext
/**
 * The real app over a test database, fake sessions and an optional fake bucket.
 * `call(path, who, init)` sends a request as `who` (a fake cookie, or null for signed out).
 */
export function testApp(get: () => { db: Db; memo: Memo; files?: unknown }) {
  const app = createApp(async (_c, run) => {
    const { db, memo } = get()
    await run({ db, memo, auth: fakeAuth, authHandler: async () => new Response('auth', { status: 200 }) })
  })
  const call = (path: string, who: string | null, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    if (who) headers.set('cookie', who)
    if (typeof init.body === 'string' && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    return app.request(`https://x.test${path}`, { ...init, headers }, { FILES: get().files }, noCtx)
  }
  return { app, call }
}
