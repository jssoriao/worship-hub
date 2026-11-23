import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { createApp } from '../src/api/app.ts'
import { devLoginEnabled } from '../src/api/dev-login.ts'
import { Memo } from '../src/api/data.ts'
import type { Db } from '../src/db/client.ts'
import { fakeAuth } from './app.ts'
import { freshDb, seedChurch, seedMember, seedUser } from './helpers.ts'
const SECRET = 'test-secret-for-dev-login-0123456789'
const noCtx = { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext
describe('dev sign-in (local development only)', () => {
  let pg: PGlite
  let db: Db
  beforeEach(async () => {
    ;({ pg, db } = await freshDb())
    await seedChurch(pg, 'org_dev000000000000000000000a', 'dev-church')
    await seedUser(pg, 'user_owner0000000000000000000a', 'owner@example.com')
    await seedMember(pg, 'org_dev000000000000000000000a', 'user_owner0000000000000000000a', 'owner')
  })
  afterEach(async () => pg.close())
  const app = createApp(async (_c, run) => run({ db, memo: new Memo(), auth: fakeAuth, authHandler: async () => new Response('auth') }))
  const req = (path: string, env: Record<string, string>, init: RequestInit = {}) =>
    app.request(`http://127.0.0.1:8787${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) } }, env, noCtx)
  const on = { DEV_LOGIN: 'on', APP_URL: 'http://127.0.0.1:8787', BETTER_AUTH_SECRET: SECRET }
  it('is off unless DEV_LOGIN is on, the app address is plain http on this machine, and there is a secret', () => {
    expect(devLoginEnabled(on)).toBe(true)
    expect(devLoginEnabled({ ...on, APP_URL: 'http://localhost:5173' })).toBe(true)
    expect(devLoginEnabled({ ...on, DEV_LOGIN: undefined as never })).toBe(false)
    expect(devLoginEnabled({ ...on, DEV_LOGIN: 'true' })).toBe(false)
    expect(devLoginEnabled({ ...on, APP_URL: 'https://worship.example.org' })).toBe(false)
    expect(devLoginEnabled({ ...on, APP_URL: 'http://worship.example.org' })).toBe(false)
    expect(devLoginEnabled({ ...on, BETTER_AUTH_SECRET: '' })).toBe(false)
    expect(devLoginEnabled(undefined)).toBe(false)
  })
  it('answers 404, as an unknown path, where it is off', async () => {
    const prod = { APP_URL: 'https://worship.example.org', BETTER_AUTH_SECRET: SECRET }
    expect((await req('/api/dev/people', prod)).status).toBe(404)
    const post = await req('/api/dev/sign-in', { ...prod, DEV_LOGIN: 'on' }, { method: 'POST', body: JSON.stringify({ churchId: 'org_dev000000000000000000000a', role: 'owner' }) })
    expect(post.status).toBe(404)
    expect(post.headers.get('Set-Cookie')).toBeNull()
  })
  it('lists who each role signs in as', async () => {
    const res = await req('/api/dev/people', on)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { churches: { id: string; people: Record<string, { email: string } | null> }[] }
    expect(body.churches[0].people.owner?.email).toBe('owner@example.com')
    expect(body.churches[0].people.editor).toBeNull()
  })
  it('signs in as the owner: a session row in that church and its signed cookie, the old cache cookie dropped', async () => {
    const res = await req('/api/dev/sign-in', on, { method: 'POST', body: JSON.stringify({ churchId: 'org_dev000000000000000000000a', role: 'owner' }) })
    expect(res.status).toBe(200)
    const cookies = res.headers.getSetCookie()
    const session = cookies.find((c) => c.startsWith('worship-hub.session_token='))!
    expect(session).toMatch(/HttpOnly/)
    expect(cookies.some((c) => c.startsWith('worship-hub.session_data=;'))).toBe(true)
    const token = decodeURIComponent(session.split(';')[0].split('=').slice(1).join('=')).split('.')[0]
    const rows = await pg.query<{ user_id: string; active_organization_id: string }>('select user_id, active_organization_id from sessions where token = $1', [token])
    expect(rows.rows).toEqual([{ user_id: 'user_owner0000000000000000000a', active_organization_id: 'org_dev000000000000000000000a' }])
  })
  it('adds a test person for a role nobody has yet, once', async () => {
    const send = () => req('/api/dev/sign-in', on, { method: 'POST', body: JSON.stringify({ churchId: 'org_dev000000000000000000000a', role: 'editor' }) })
    expect((await send()).status).toBe(200)
    expect((await send()).status).toBe(200)
    const rows = await pg.query<{ email: string; role: string }>("select u.email, m.role from members m join users u on u.id = m.user_id where m.role = 'editor'")
    expect(rows.rows).toEqual([{ email: 'editor.dev@example.test', role: 'editor' }])
  })
  it('refuses an unknown role or church', async () => {
    expect((await req('/api/dev/sign-in', on, { method: 'POST', body: JSON.stringify({ churchId: 'org_dev000000000000000000000a', role: 'boss' }) })).status).toBe(400)
    expect((await req('/api/dev/sign-in', on, { method: 'POST', body: JSON.stringify({ churchId: 'org_nope00000000000000000000a', role: 'owner' }) })).status).toBe(404)
  })
})
