// The typed client (hono/client) against the real app: the calls the web app makes reach the right routes.
import { hc } from 'hono/client'
import { beforeEach, describe, expect, it } from 'vitest'
import type { AppType } from '../src/api/app.ts'
import { Memo } from '../src/api/data.ts'
import type { Db } from '../src/db/client.ts'
import { testApp } from './app.ts'
import { FakeR2 } from './fake-r2.ts'
import { freshDb, seedChurch, seedMember, seedUser } from './helpers.ts'
const A = 'org_aaaaaaaaaaaaaaaaaaaaaaaa'
const SONG = 'song_aaaaaaaaaaaaaaaaaaaaaaaa'
let db: Db
let pg: Awaited<ReturnType<typeof freshDb>>['pg']
let r2: FakeR2
const { call } = testApp(() => ({ db, memo: new Memo(), files: r2 }))
/** A client signed in as `who`, sending through the test app. */
const as = (who: string) =>
  hc<AppType>('https://x.test', {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString())
      return call(url.pathname + url.search, `user=${who}; church=${A}`, init)
    },
  })
beforeEach(async () => {
  ;({ pg, db } = await freshDb())
  r2 = new FakeR2()
  await seedChurch(pg, A, 'a')
  for (const role of ['member', 'editor', 'owner']) {
    await seedUser(pg, role)
    await seedMember(pg, A, role, role)
  }
  await pg.query(`insert into songs (id, organization_id, title, has_stems) values ($1, $2, 'Song', true)`, [SONG, A])
  await r2.put(`churches/${A}/songs/${SONG}/analysis.json`, '{"v":1}')
})
describe('typed client', () => {
  it('songs: list, add, edit details, chart, analysis and its history', async () => {
    const api = as('owner').songs
    const list = await (await api['index.json'].$get()).json()
    expect(list.map((s) => s.title)).toEqual(['Song'])
    const added = await api.new.$post({ json: { title: 'New one' } })
    expect(added.status).toBe(201)
    const song = await added.json()
    if ('error' in song) throw new Error(song.error)
    const one = api[':songId']
    expect((await one.$patch({ param: { songId: song.id }, json: { key: 'D' } })).status).toBe(200)
    const chart = await one['chart.pro'].$put({ param: { songId: song.id } }, { init: { body: '{title: x}', headers: { 'Content-Type': 'text/plain' } } })
    expect(chart.status).toBe(204)
    expect(r2.objects.has(`churches/${A}/songs/${song.id}/chart.pro`)).toBe(true)
    const analysis = { v: 1 as const, beats: [], chords: [], sections: [], lines: [] }
    expect((await one['analysis.json'].$put({ param: { songId: SONG }, json: analysis })).status).toBe(200)
    const history = await (await one.analysis.history.$get({ param: { songId: SONG } })).json()
    expect(history).toHaveLength(1)
    // archive and restore, and the admin list
    expect((await one.archive.$post({ param: { songId: song.id } })).status).toBe(200)
    const admin = await (await api['admin.json'].$get()).json()
    expect(admin.find((s) => s.id === song.id)).toMatchObject({ title: 'New one', has: { chart: true, analysis: false } })
    expect(admin.find((s) => s.id === song.id)?.archivedAt).toBeTruthy()
    expect((await one.restore.$post({ param: { songId: song.id } })).status).toBe(200)
  })
  it('arrangements: save, list, load, delete', async () => {
    const arr = as('member').songs[':songId'].arrangements
    const param = { songId: SONG, arrangementId: 'arr_ssssssssssssssssssssssss' }
    const saved = await arr[':arrangementId'].$put({ param, json: { name: 'Sunday', sections: [], blocks: [] } })
    expect(saved.status).toBe(200)
    expect((await (await arr.$get({ param: { songId: SONG } })).json()).map((a) => a.id)).toEqual(['arr_ssssssssssssssssssssssss'])
    expect(await (await arr[':arrangementId'].$get({ param })).json()).toMatchObject({ id: 'arr_ssssssssssssssssssssssss', name: 'Sunday', owner: 'member' })
    expect((await arr[':arrangementId'].$delete({ param })).status).toBe(200)
  })
  it('members: list, add, change role, remove', async () => {
    const api = as('owner').api.church.members
    const list = await (await api.$get()).json()
    expect(list.members).toHaveLength(3)
    const added = await (await api.$post({ json: { email: 'new@example.com', role: 'member' } })).json()
    if ('error' in added) throw new Error(added.error)
    expect((await api[':memberId'].$patch({ param: { memberId: added.id }, json: { role: 'editor' } })).status).toBe(200)
    expect((await api[':memberId'].$delete({ param: { memberId: added.id } })).status).toBe(200)
  })
  it('errors arrive as JSON { error }', async () => {
    const res = await as('member').songs.new.$post({ json: { title: 'x' } })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden' })
  })
})
