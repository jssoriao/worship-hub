import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../src/db/client.ts'
import { Memo } from '../src/api/data.ts'
import { testApp } from './app.ts'
import { FakeR2 } from './fake-r2.ts'
import { freshDb, seedChurch, seedMember, seedUser } from './helpers.ts'

const A = 'org_aaaaaaaaaaaaaaaaaaaaaaaa'
const B = 'org_bbbbbbbbbbbbbbbbbbbbbbbb'
const ONE = 'song_aaaaaaaaaaaaaaaaaaaaaaa1'
const TWO = 'song_aaaaaaaaaaaaaaaaaaaaaaa2'
const OTHER = 'song_bbbbbbbbbbbbbbbbbbbbbbbb'

let db: Db
let pg: Awaited<ReturnType<typeof freshDb>>['pg']
let r2: FakeR2
const cache = new Memo(30_000, () => 0)
const { call } = testApp(() => ({ db, memo: cache, files: r2 }))
const as = (role: string, church = A) => `user=${role}-a; church=${church}`
const post = (path: string, who: string | null, body?: unknown) => call(path, who, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const titles = async (path: string, who: string) => ((await (await call(path, who)).json()) as { title: string }[]).map((s) => s.title)

beforeEach(async () => {
  ;({ pg, db } = await freshDb())
  r2 = new FakeR2()
  cache.clear()
  await seedChurch(pg, A, 'a')
  await seedChurch(pg, B, 'b')
  for (const role of ['member', 'editor', 'admin', 'owner']) {
    await seedUser(pg, `${role}-a`)
    await seedMember(pg, A, `${role}-a`, role)
  }
  await seedUser(pg, 'bob-b')
  await seedMember(pg, B, 'bob-b', 'owner')
  await pg.query(`insert into songs (id, organization_id, title, has_stems) values ($1, $2, 'First', true), ($3, $2, 'Second', false), ($4, $5, 'Other', true)`, [ONE, A, TWO, OTHER, B])
  await r2.put(`churches/${A}/songs/${ONE}/stems/manifest.json`, '{}')
  await r2.put(`churches/${A}/songs/${ONE}/analysis.json`, '{"v":1}')
  await r2.put(`churches/${A}/songs/${TWO}/chart.pro`, '{title: x}')
})

describe('archiving a song', () => {
  it('is for admins and owners only', async () => {
    for (const role of ['member', 'editor']) {
      expect((await post(`/songs/${ONE}/archive`, as(role))).status).toBe(403)
      expect((await call('/songs/admin.json', as(role))).status).toBe(403)
    }
    expect((await post(`/songs/${ONE}/archive`, null)).status).toBe(401)
    expect((await post(`/songs/${ONE}/archive`, as('admin'))).status).toBe(200)
  })

  it('hides the song from the library and from every route about it, and keeps its files', async () => {
    expect((await post(`/songs/${ONE}/archive`, as('admin'))).status).toBe(200)
    expect(await titles('/songs/index.json', as('member'))).toEqual(['Second'])
    expect((await call(`/songs/${ONE}/stems/manifest.json`, as('member'))).status).toBe(404)
    expect((await call(`/songs/${ONE}/analysis.json`, as('editor'), { method: 'PUT', body: '{"v":1,"beats":[],"chords":[],"sections":[],"lines":[]}' })).status).toBe(404)
    expect((await call(`/songs/${ONE}`, as('editor'), { method: 'PATCH', body: JSON.stringify({ title: 'X' }) })).status).toBe(404)
    // nothing is removed
    expect(r2.objects.has(`churches/${A}/songs/${ONE}/stems/manifest.json`)).toBe(true)
    expect(r2.objects.has(`churches/${A}/songs/${ONE}/analysis.json`)).toBe(true)
  })

  it('applies at once even after the song was looked up a moment ago', async () => {
    expect((await call(`/songs/${ONE}/stems/manifest.json`, as('member'))).status).toBe(200) // now remembered as a song of this church
    await post(`/songs/${ONE}/archive`, as('admin'))
    expect((await call(`/songs/${ONE}/stems/manifest.json`, as('member'))).status).toBe(404)
  })

  it('cannot be done twice, to another church, or to something that is not a song', async () => {
    expect((await post(`/songs/${ONE}/archive`, as('admin'))).status).toBe(200)
    expect((await post(`/songs/${ONE}/archive`, as('admin'))).status).toBe(404)
    expect((await post(`/songs/${OTHER}/archive`, as('admin'))).status).toBe(404)
    expect((await post(`/songs/not-a-song/archive`, as('admin'))).status).toBe(404)
    expect((await pg.query('select archived_at from songs where id = $1', [OTHER])).rows[0]).toEqual({ archived_at: null })
  })

  it('records who archived it, and restoring brings everything back', async () => {
    await post(`/songs/${ONE}/archive`, as('admin'))
    expect((await pg.query<{ archived_by: string }>('select archived_by from songs where id = $1', [ONE])).rows[0].archived_by).toBe('admin-a')
    expect((await post(`/songs/${ONE}/restore`, as('editor'))).status).toBe(403)
    expect((await post(`/songs/${ONE}/restore`, as('owner'))).status).toBe(200)
    expect((await post(`/songs/${ONE}/restore`, as('owner'))).status).toBe(404) // not archived any more
    expect(await titles('/songs/index.json', as('member'))).toEqual(['First', 'Second'])
    expect((await call(`/songs/${ONE}/stems/manifest.json`, as('member'))).status).toBe(200)
    expect((await pg.query('select archived_by from songs where id = $1', [ONE])).rows[0]).toEqual({ archived_by: null })
  })

  it('cannot restore a song of another church', async () => {
    await pg.query(`update songs set archived_at = now() where id = $1`, [OTHER])
    expect((await post(`/songs/${OTHER}/restore`, as('owner'))).status).toBe(404)
  })

  it('keeps the title taken, and says so when someone tries it again', async () => {
    await post(`/songs/${ONE}/archive`, as('admin'))
    const again = await post('/songs/new', as('admin'), { title: 'First' })
    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({ error: 'A song with this name is in the archive. Restore it from Songs.' })
    const clash = await post('/songs/new', as('admin'), { title: 'Second' })
    expect(await clash.json()).toEqual({ error: 'A song with this name exists already' })
    const rename = await call(`/songs/${TWO}`, as('editor'), { method: 'PATCH', body: JSON.stringify({ title: 'First' }) })
    expect(rename.status).toBe(409)
    expect(((await rename.json()) as { error: string }).error).toContain('archive')
  })
})

describe('the admin list', () => {
  it('has every song with what it has, archived ones marked', async () => {
    await post(`/songs/${TWO}/archive`, as('admin'))
    const list = (await (await call('/songs/admin.json', as('owner'))).json()) as { id: string; title: string; archivedAt: string | null; archivedBy: string | null; has: Record<string, boolean> }[]
    expect(list.map((s) => s.title)).toEqual(['First', 'Second'])
    expect(list[0]).toMatchObject({ id: ONE, archivedAt: null, has: { stems: true, analysis: true, chart: false } })
    expect(list[1]).toMatchObject({ id: TWO, archivedBy: 'admin-a', has: { stems: false, analysis: false, chart: true } })
    expect(list[1].archivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('shows only the church of the person asking', async () => {
    const list = (await (await call('/songs/admin.json', `user=bob-b; church=${B}`)).json()) as { title: string }[]
    expect(list.map((s) => s.title)).toEqual(['Other'])
  })
})
