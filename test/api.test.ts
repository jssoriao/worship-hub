// How the Hono app answers around the routes: cookies, methods, paths, bodies and cache headers.
import { beforeEach, describe, expect, it } from 'vitest'
import { Memo } from '../src/api/data.ts'
import type { Db } from '../src/db/client.ts'
import { testApp } from './app.ts'
import { FakeR2 } from './fake-r2.ts'
import { freshDb, seedChurch, seedMember, seedUser } from './helpers.ts'
const A = 'churchaaaaaa'
const SONG = 'songaaaaaaaa'
let db: Db
let pg: Awaited<ReturnType<typeof freshDb>>['pg']
let r2: FakeR2
let memo: Memo
const { call } = testApp(() => ({ db, memo, files: r2 }))
const as = (role: string) => `user=${role}; church=${A}`
beforeEach(async () => {
  ;({ pg, db } = await freshDb())
  r2 = new FakeR2()
  memo = new Memo()
  await seedChurch(pg, A, 'a')
  for (const role of ['member', 'editor', 'owner']) {
    await seedUser(pg, role)
    await seedMember(pg, A, role, role)
  }
  await pg.query(`insert into songs (id, organization_id, title, has_stems) values ($1, $2, 'Song', true)`, [SONG, A])
  await r2.put(`churches/${A}/songs/${SONG}/stems/a.mp3`, new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))
  await r2.put(`churches/${A}/songs/${SONG}/analysis.json`, '{"v":1}')
})
describe('session cookie', () => {
  it('passes a refreshed cookie on, on JSON and on files', async () => {
    for (const path of ['/songs/index.json', `/songs/${SONG}/stems/a.mp3`, '/api/church/members']) {
      const res = await call(path, `${as('owner')} refresh`)
      expect(res.status).toBe(200)
      expect(res.headers.getSetCookie()).toEqual(['session=refreshed; Path=/'])
    }
    expect((await call('/songs/index.json', as('owner'))).headers.getSetCookie()).toEqual([])
  })
})
describe('paths and methods', () => {
  it('takes paths with or without a trailing slash', async () => {
    for (const path of [`/songs/${SONG}/arrangements`, `/songs/${SONG}/arrangements/`, `/songs/${SONG}/analysis/history`, `/songs/${SONG}/analysis/history/`]) {
      expect((await call(path, as('member'))).status).toBe(200)
    }
    expect((await call('/api/church/members/', as('owner'))).status).toBe(200)
  })
  it('answers HEAD for files with the size and no body', async () => {
    const res = await call(`/songs/${SONG}/stems/a.mp3`, as('member'), { method: 'HEAD' })
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Length')).toBe('10')
    expect((await res.arrayBuffer()).byteLength).toBe(0)
  })
  it('405 for a known path with the wrong method', async () => {
    expect((await call('/songs/index.json', as('owner'), { method: 'POST', body: '{}' })).status).toBe(405)
    expect((await call('/songs/new', as('owner'))).status).toBe(405)
    expect((await call(`/songs/${SONG}`, as('owner'))).status).toBe(405)
    expect((await call(`/songs/${SONG}/stems/a.mp3`, as('owner'), { method: 'PUT', body: 'x' })).status).toBe(405)
    expect((await call(`/songs/${SONG}/analysis/history`, as('owner'), { method: 'DELETE' })).status).toBe(405)
  })
  it('404 for unknown paths: JSON under /api, text elsewhere', async () => {
    const api = await call('/api/nothing', as('owner'))
    expect(api.status).toBe(404)
    expect(await api.json()).toEqual({ error: 'not found' })
    expect((await call('/songs/not-an-id/x', as('owner'))).status).toBe(404)
    expect((await call(`/songs/${SONG}/arrangements/bad`, as('owner'))).status).toBe(404)
    expect((await call(`/songs/${SONG}/stems/..%2Fa.mp3`, as('owner'))).status).toBe(404)
  })
  it('keeps the organization endpoints the app does not use closed', async () => {
    expect((await call('/api/auth/organization/create', null, { method: 'POST', body: '{}' })).status).toBe(404)
    const open = await call('/api/auth/get-session', null)
    expect(await open.text()).toBe('auth') // reached the Better Auth handler
  })
})
describe('bodies', () => {
  it('400 for malformed JSON or a body that is not JSON', async () => {
    expect((await call('/songs/new', as('owner'), { method: 'POST', body: '{not json' })).status).toBe(400)
    expect((await call('/songs/new', as('owner'), { method: 'POST', body: 'title', headers: { 'Content-Type': 'text/plain' } })).status).toBe(400)
  })
  it('checks song details', async () => {
    const patch = (body: unknown) => call(`/songs/${SONG}`, as('editor'), { method: 'PATCH', body: JSON.stringify(body) })
    expect((await patch({ bpm: 0 })).status).toBe(400)
    expect((await patch({ meter: 4.5 })).status).toBe(400)
    expect((await patch({ title: '   ' })).status).toBe(400)
    const res = await patch({ title: '  Renamed  ', artist: '', key: 'G' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ title: 'Renamed', artist: null, key: 'G' })
  })
  it('413 for a body over the limit', async () => {
    const big = 'x'.repeat(200 * 1024 + 1)
    expect((await call(`/songs/${SONG}/chart.pro`, as('editor'), { method: 'PUT', body: big, headers: { 'Content-Type': 'text/plain' } })).status).toBe(413)
    expect(r2.objects.has(`churches/${A}/songs/${SONG}/chart.pro`)).toBe(false)
  })
  it('400 for an analysis of the wrong shape, and the stored copy stays', async () => {
    const res = await call(`/songs/${SONG}/analysis.json`, as('editor'), { method: 'PUT', body: JSON.stringify({ v: 2, beats: [], chords: [], sections: [], lines: [] }) })
    expect(res.status).toBe(400)
    expect(await (await r2.get(`churches/${A}/songs/${SONG}/analysis.json`))!.text()).toBe('{"v":1}')
  })
})
describe('cache headers', () => {
  it('no-store unless the route says otherwise', async () => {
    expect((await call('/api/church/members', as('owner'))).headers.get('Cache-Control')).toBe('no-store')
    expect((await call('/songs/index.json', as('owner'))).headers.get('Cache-Control')).toBe('private, no-cache')
    expect((await call(`/songs/${SONG}/stems/a.mp3`, as('owner'))).headers.get('Cache-Control')).toBe('private, max-age=3600')
    expect((await call('/songs/index.json', null)).headers.get('Cache-Control')).toBe('no-store')
  })
})
