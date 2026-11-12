import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../worker/data.ts'
import { Memo } from '../worker/data.ts'
import { songKey, songPrefix, parseSongPath } from '../worker/keys.ts'
import { routeSongs } from '../worker/router.ts'
import { authPathAllowed, type SessionSource } from '../worker/tenant.ts'
import { FakeR2 } from './fake-r2.ts'
import { freshDb, seedChurch, seedMember, seedUser } from './helpers.ts'

// ids are 12 chars of [a-z0-9]
const A = 'churchaaaaaa'
const B = 'churchbbbbbb'
const SONG_A = 'songaaaaaaaa'
const SONG_B = 'songbbbbbbbb'
const noWait = { waitUntil: () => {} }

/** Sessions are faked: the "cookie" header is `user=<id>; church=<id|none>`. */
const auth: SessionSource = {
  api: {
    async getSession({ headers }) {
      const m = /user=([^;]+); church=(\S+)/.exec(headers.get('cookie') ?? '')
      if (!m) return { headers: new Headers(), response: null }
      return {
        headers: new Headers(),
        response: { session: { activeOrganizationId: m[2] === 'none' ? null : m[2] }, user: { id: m[1], name: m[1], email: `${m[1]}@example.com` } },
      }
    },
  },
}

let db: Db
let pg: Awaited<ReturnType<typeof freshDb>>['pg']
let r2: FakeR2
let cache: Memo
let now: number

const call = (path: string, who: string | null, init: RequestInit = {}) =>
  routeSongs(
    new Request(`https://x.test${path}`, { ...init, headers: { ...(who ? { cookie: who } : {}), ...(init.headers as Record<string, string>) } }),
    { FILES: r2 as never },
    noWait,
    auth,
    db,
    cache,
  )
const asA = (role: string) => `user=${role}-a; church=${A}`

beforeEach(async () => {
  ;({ pg, db } = await freshDb())
  r2 = new FakeR2()
  now = 0
  cache = new Memo(30_000, () => now)
  await seedChurch(pg, A, 'a')
  await seedChurch(pg, B, 'b')
  for (const role of ['member', 'editor', 'admin', 'owner']) {
    await seedUser(pg, `${role}-a`)
    await seedMember(pg, A, `${role}-a`, role)
  }
  await seedUser(pg, 'bob-b')
  await seedMember(pg, B, 'bob-b', 'owner')
  await pg.query(`insert into song (id, "organizationId", title, "hasStems") values ($1, $2, 'Song A', true), ($3, $4, 'Song B', true)`, [SONG_A, A, SONG_B, B])
  await r2.put(`churches/${A}/songs/${SONG_A}/stems/manifest.json`, '{"title":"A"}', { httpMetadata: { contentType: 'application/json' } })
  await r2.put(`churches/${A}/songs/${SONG_A}/stems/a.mp3`, new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))
  await r2.put(`churches/${B}/songs/${SONG_B}/stems/manifest.json`, '{"title":"B"}')
  await r2.put(`churches/${A}/songs/${SONG_A}/analysis.json`, '{"v":1}')
})

describe('keys', () => {
  it('builds keys only under the song prefix', () => {
    expect(songKey(A, SONG_A, ['stems', 'a.mp3'])).toBe(`churches/${A}/songs/${SONG_A}/stems/a.mp3`)
    for (const bad of [['..', 'x'], ['.'], [''], ['a/b'], ['a\\b'], ['x\0']]) expect(songKey(A, SONG_A, bad)).toBeNull()
    expect(songKey('short', SONG_A, ['x'])).toBeNull()
    expect(songKey(A, '../other', ['x'])).toBeNull()
    expect(songPrefix(A, 'UPPERCASE123')).toBeNull()
  })
  it('parses paths and rejects traversal', () => {
    expect(parseSongPath('/songs/index.json')).toEqual({ kind: 'index' })
    expect(parseSongPath(`/songs/${SONG_A}/stems/a%20b.mp3`)).toEqual({ kind: 'song', songId: SONG_A, rest: ['stems', 'a b.mp3'], trailingSlash: false })
    expect(parseSongPath(`/songs/${SONG_A}/..%2Fx`)).toBeNull()
    expect(parseSongPath(`/songs/${SONG_A}/stems/../x`)).toBeNull()
    expect(parseSongPath('/songs/some-song-title/stems/manifest.json')).toBeNull() // old slugs are gone
  })
})

describe('auth guard', () => {
  it('closes the organization endpoints the app does not use', () => {
    expect(authPathAllowed('/api/auth/organization/create')).toBe(false)
    expect(authPathAllowed('/api/auth/organization/invite-member')).toBe(false)
    expect(authPathAllowed('/api/auth/Organization/Create')).toBe(false)
    expect(authPathAllowed('/api/auth//organization//create')).toBe(false)
    expect(authPathAllowed('/api/auth/organization/set-active')).toBe(true)
    expect(authPathAllowed('/api/auth/organization/list')).toBe(true)
    expect(authPathAllowed('/api/auth/email-otp/send-verification-otp')).toBe(true)
  })
})

describe('session and church', () => {
  it('401 without a session, 409 without an active church, 403 for a non-member', async () => {
    expect((await call('/songs/index.json', null)).status).toBe(401)
    expect((await call('/songs/index.json', 'user=member-a; church=none')).status).toBe(409)
    expect((await call('/songs/index.json', `user=bob-b; church=${A}`)).status).toBe(403)
  })
  it('lists only the active church songs', async () => {
    const list = (await (await call('/songs/index.json', asA('member'))).json()) as { id: string }[]
    expect(list.map((s) => s.id)).toEqual([SONG_A])
    const other = (await (await call('/songs/index.json', `user=bob-b; church=${B}`)).json()) as { id: string }[]
    expect(other.map((s) => s.id)).toEqual([SONG_B])
  })
  it('a removed member is denied once the memo expires', async () => {
    expect((await call('/songs/index.json', asA('member'))).status).toBe(200)
    await pg.query(`delete from member where "userId" = 'member-a'`)
    expect((await call('/songs/index.json', asA('member'))).status).toBe(200) // inside the 30 s window
    now = 31_000
    expect((await call('/songs/index.json', asA('member'))).status).toBe(403)
  })
})

describe('tenancy: church A cannot touch church B song', () => {
  const asBob = `user=bob-b; church=${B}`
  it.each([
    ['GET', `/songs/${SONG_A}/stems/manifest.json`],
    ['HEAD', `/songs/${SONG_A}/stems/a.mp3`],
    ['GET', `/songs/${SONG_A}/analysis/history/`],
    ['GET', `/songs/${SONG_A}/arrangements/`],
    ['PUT', `/songs/${SONG_A}/chart.pro`],
    ['PUT', `/songs/${SONG_A}/analysis.json`],
    ['PATCH', `/songs/${SONG_A}`],
    ['DELETE', `/songs/${SONG_A}`],
  ])('%s %s -> 404 for the other church (even as owner)', async (method, path) => {
    const res = await call(path, asBob, { method, body: method === 'GET' || method === 'HEAD' ? undefined : '{}' })
    expect(res.status).toBe(404)
    // nothing of A changed
    expect(r2.objects.has(`churches/${A}/songs/${SONG_A}/stems/manifest.json`)).toBe(true)
    expect((await pg.query('select 1 from song where id = $1', [SONG_A])).rows).toHaveLength(1)
  })
  it('an active church the person is not in is refused', async () => {
    expect((await call(`/songs/${SONG_A}/stems/manifest.json`, `user=bob-b; church=${A}`)).status).toBe(403)
  })
  it('arrangements of A are invisible to B', async () => {
    const body = JSON.stringify({ name: 'mine', sections: [], blocks: [] })
    expect((await call(`/songs/${SONG_A}/arrangements/arr123456.json`, asA('member'), { method: 'PUT', body })).status).toBe(200)
    expect((await call(`/songs/${SONG_A}/arrangements/arr123456.json`, asBob)).status).toBe(404)
    // B cannot overwrite A's arrangement id by saving to its own song
    const res = await call(`/songs/${SONG_B}/arrangements/arr123456.json`, asBob, { method: 'PUT', body })
    expect([404, 403, 200]).toContain(res.status)
    const { rows } = await pg.query<{ songId: string; owner: string }>('select "songId", owner from arrangement where id = $1', ['arr123456'])
    expect(rows).toEqual([{ songId: SONG_A, owner: 'member-a' }])
  })
})

describe('serving files', () => {
  it('serves manifest and a byte range from the id based path', async () => {
    const man = await call(`/songs/${SONG_A}/stems/manifest.json`, asA('member'))
    expect(await man.text()).toBe('{"title":"A"}')
    const part = await call(`/songs/${SONG_A}/stems/a.mp3`, asA('member'), { headers: { Range: 'bytes=2-5' } })
    expect(part.status).toBe(206)
    expect(part.headers.get('Content-Range')).toBe('bytes 2-5/10')
    expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([2, 3, 4, 5])
  })
  it('404s for a missing file of an own song', async () => {
    expect((await call(`/songs/${SONG_A}/stems/none.mp3`, asA('member'))).status).toBe(404)
  })
})

describe('permissions per route', () => {
  const post = (path: string, who: string, body: unknown, method = 'POST') => call(path, who, { method, body: JSON.stringify(body) })
  it('song:create is admin and up', async () => {
    for (const role of ['member', 'editor']) expect((await post('/songs/new', asA(role), { title: 'New' })).status).toBe(403)
    const res = await post('/songs/new', asA('admin'), { title: 'New' })
    expect(res.status).toBe(201)
    const song = (await res.json()) as { id: string; stems: boolean }
    expect(song.id).toMatch(/^[a-z0-9]{12}$/)
    expect(song.stems).toBe(false)
    expect((await post('/songs/new', asA('owner'), { title: 'New' })).status).toBe(409)
  })
  it('content:edit (chart, analysis, details) is editor and up', async () => {
    const analysis = JSON.stringify({ v: 1, beats: [], chords: [], sections: [], lines: [] })
    expect((await call(`/songs/${SONG_A}/chart.pro`, asA('member'), { method: 'PUT', body: '{title: x}' })).status).toBe(403)
    expect((await call(`/songs/${SONG_A}/chart.pro`, asA('editor'), { method: 'PUT', body: '{title: x}' })).status).toBe(204)
    expect(r2.objects.has(`churches/${A}/songs/${SONG_A}/chart.pro`)).toBe(true)
    expect((await call(`/songs/${SONG_A}/analysis.json`, asA('member'), { method: 'PUT', body: analysis })).status).toBe(403)
    expect((await call(`/songs/${SONG_A}/analysis.json`, asA('editor'), { method: 'PUT', body: analysis })).status).toBe(200)
    const history = (await (await call(`/songs/${SONG_A}/analysis/history/`, asA('member'))).json()) as unknown[]
    expect(history).toHaveLength(1) // the replaced copy is kept
    expect((await post(`/songs/${SONG_A}`, asA('member'), { title: 'Z' }, 'PATCH')).status).toBe(403)
    expect((await post(`/songs/${SONG_A}`, asA('editor'), { title: 'Song A2', bpm: 72.5, key: 'G' }, 'PATCH')).status).toBe(200)
  })
  it('song:delete is admin and up, and removes the files', async () => {
    expect((await call(`/songs/${SONG_A}`, asA('editor'), { method: 'DELETE' })).status).toBe(403)
    expect((await call(`/songs/${SONG_A}`, asA('admin'), { method: 'DELETE' })).status).toBe(204)
    expect([...r2.objects.keys()].filter((k) => k.includes(SONG_A))).toEqual([])
    expect(r2.objects.has(`churches/${B}/songs/${SONG_B}/stems/manifest.json`)).toBe(true) // other church untouched
  })
  it('arrangements: members make their own; only the owner or a manager changes them', async () => {
    const body = JSON.stringify({ name: 'Sunday', sections: [], blocks: [] })
    const url = `/songs/${SONG_A}/arrangements/sunday01.json`
    expect((await call(url, asA('member'), { method: 'PUT', body })).status).toBe(200)
    // another member (a second member user)
    await seedUser(pg, 'member2-a')
    await seedMember(pg, A, 'member2-a', 'member')
    expect((await call(url, `user=member2-a; church=${A}`, { method: 'PUT', body })).status).toBe(403)
    expect((await call(url, `user=member2-a; church=${A}`, { method: 'DELETE' })).status).toBe(403)
    expect((await call(url, asA('editor'), { method: 'PUT', body })).status).toBe(200)
    const list = (await (await call(`/songs/${SONG_A}/arrangements/`, asA('member'))).json()) as { id: string; owner: string }[]
    expect(list).toHaveLength(1)
    expect(list[0].owner).toBe('member-a') // the owner is kept when a manager saves
    expect((await call(url, asA('member'), { method: 'DELETE' })).status).toBe(200)
  })
  it('refuses writes from another origin', async () => {
    const res = await call('/songs/new', asA('owner'), { method: 'POST', body: '{"title":"X"}', headers: { Origin: 'https://evil.test' } })
    expect(res.status).toBe(403)
  })
})
