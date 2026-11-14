import { beforeEach, describe, expect, it } from 'vitest'
import { Memo } from '../src/api/data.ts'
import type { Db } from '../src/db/client.ts'
import { testApp } from './app.ts'
import { freshDb, seedChurch, seedMember, seedUser } from './helpers.ts'
const A = 'org_aaaaaaaaaaaaaaaaaaaaaaaa'
const B = 'org_bbbbbbbbbbbbbbbbbbbbbbbb'
const SONG_A = 'song_aaaaaaaaaaaaaaaaaaaaaaaa'
const SONG_B = 'song_bbbbbbbbbbbbbbbbbbbbbbbb'
let db: Db
let pg: Awaited<ReturnType<typeof freshDb>>['pg']
const as = (user: string, church = A) => `user=${user}; church=${church}`
const app = testApp(() => ({ db, memo: new Memo() }))
const call = (who: string | null, method: string, path = '', body?: unknown) =>
  app.call(`/api/church/services${path}`, who, { method, body: body === undefined ? undefined : JSON.stringify(body) })
type Service = { id: string; date: string; time: string | null; title: string | null; items: { id: string; kind: string; songId: string | null; title: string; key: string | null; songKey: string | null; notes: string | null; links: { url: string; label: string }[] }[] }
const make = async (body: Record<string, unknown> = { date: '2031-03-02' }, who = 'editor') => {
  const res = await call(as(who), 'POST', '', body)
  return { res, service: ((await res.json()) as { service: Service }).service }
}
beforeEach(async () => {
  ;({ pg, db } = await freshDb())
  await seedChurch(pg, A, 'a')
  await seedChurch(pg, B, 'b')
  for (const role of ['member', 'editor', 'admin', 'owner']) {
    await seedUser(pg, role)
    await seedMember(pg, A, role, role)
  }
  await seedUser(pg, 'bob')
  await seedMember(pg, B, 'bob', 'owner')
  await pg.query(`insert into songs (id, organization_id, title, music_key) values ($1, $2, 'Song A', 'E'), ($3, $4, 'Song B', 'G')`, [SONG_A, A, SONG_B, B])
})
describe('access', () => {
  it('needs a session', async () => {
    expect((await call(null, 'GET')).status).toBe(401)
  })
  it('lets members read but not plan; editors, admins and owners plan', async () => {
    const { service } = await make()
    expect((await call(as('member'), 'GET')).status).toBe(200)
    expect((await call(as('member'), 'GET', `/${service.id}`)).status).toBe(200)
    expect((await call(as('member'), 'POST', '', { date: '2031-03-09' })).status).toBe(403)
    expect((await call(as('member'), 'PATCH', `/${service.id}`, { title: 'x' })).status).toBe(403)
    expect((await call(as('member'), 'PUT', `/${service.id}/items`, { items: [] })).status).toBe(403)
    expect((await call(as('member'), 'DELETE', `/${service.id}`)).status).toBe(403)
    expect((await call(as('member'), 'POST', `/${service.id}/clone`, { date: '2031-05-04' })).status).toBe(403)
    for (const [i, role] of ['editor', 'admin', 'owner'].entries()) expect((await call(as(role), 'POST', '', { date: `2031-04-0${i + 1}` })).status).toBe(201)
  })
  it('keeps churches apart', async () => {
    const { service } = await make()
    expect((await call(as('bob', B), 'GET', `/${service.id}`)).status).toBe(404)
    expect((await call(as('bob', B), 'PATCH', `/${service.id}`, { title: 'x' })).status).toBe(404)
    expect((await call(as('bob', B), 'PUT', `/${service.id}/items`, { items: [] })).status).toBe(404)
    expect((await call(as('bob', B), 'DELETE', `/${service.id}`)).status).toBe(404)
    expect(((await (await call(as('bob', B), 'GET')).json()) as { services: unknown[] }).services).toEqual([])
    expect((await call(as('editor'), 'GET', '/not-an-id')).status).toBe(404)
  })
})
describe('services', () => {
  it('stores date and optional time, and lists newest first', async () => {
    await make({ date: '2031-03-02', title: ' Sunday ' })
    await make({ date: '2031-03-09', time: '09:30' })
    await make({ date: '2031-03-09', time: '18:00' })
    const { services } = (await (await call(as('member'), 'GET')).json()) as { services: { date: string; time: string | null; title: string | null }[] }
    expect(services.map((s) => [s.date, s.time])).toEqual([['2031-03-09', '09:30'], ['2031-03-09', '18:00'], ['2031-03-02', null]])
    expect(services[2].title).toBe('Sunday')
  })
  it('refuses a second service at the same date and time, untimed included', async () => {
    await make({ date: '2031-03-02' })
    expect((await make({ date: '2031-03-02' })).res.status).toBe(409)
    await make({ date: '2031-03-02', time: '09:30' })
    expect((await make({ date: '2031-03-02', time: '09:30' })).res.status).toBe(409)
    // another church may use the same date
    expect((await call(as('bob', B), 'POST', '', { date: '2031-03-02' })).status).toBe(201)
  })
  it('refuses bad dates and times', async () => {
    for (const body of [{}, { date: '2031-02-30' }, { date: '03/02/2031' }, { date: '2031-03-02', time: '25:00' }, { date: '2031-03-02', time: '9:30' }]) {
      expect((await make(body)).res.status).toBe(400)
    }
  })
  it('changes fields, clears the time, and keeps the unique rule on a move', async () => {
    const one = (await make({ date: '2031-03-02', time: '09:30' })).service
    await make({ date: '2031-03-09' })
    const res = await call(as('editor'), 'PATCH', `/${one.id}`, { time: null, title: 'Easter' })
    const { service } = (await res.json()) as { service: Service }
    expect([service.time, service.title]).toEqual([null, 'Easter'])
    expect((await call(as('editor'), 'PATCH', `/${one.id}`, { date: '2031-03-09' })).status).toBe(409)
  })
  it('clones a service with its setlist onto another date, in the same church only', async () => {
    const { service } = await make({ date: '2031-03-02', title: 'Sunday', notes: 'Bring capos' })
    await call(as('editor'), 'PUT', `/${service.id}/items`, { items: [{ songId: SONG_A, key: 'F', notes: 'slow', links: [{ url: 'https://example.com/v', label: 'Demo' }] }, { title: 'Prayer' }] })
    const res = await call(as('editor'), 'POST', `/${service.id}/clone`, { date: '2031-03-09', time: '10:00' })
    expect(res.status).toBe(201)
    const { service: copy } = (await res.json()) as { service: Service & { notes: string | null } }
    expect([copy.date, copy.time, copy.title, copy.notes]).toEqual(['2031-03-09', '10:00', 'Sunday', 'Bring capos'])
    expect(copy.id).not.toBe(service.id)
    expect(copy.items.map((i) => [i.title, i.key, i.links.length])).toEqual([['Song A', 'F', 1], ['Prayer', null, 0]])
    expect(copy.items.some((i) => service.items.some((o) => o.id === i.id))).toBe(false)
    expect((await call(as('editor'), 'POST', `/${service.id}/clone`, { date: '2031-03-09', time: '10:00' })).status).toBe(409)
    expect((await call(as('bob', B), 'POST', `/${service.id}/clone`, { date: '2031-03-16' })).status).toBe(404)
  })
  it('deletes a service with its items', async () => {
    const { service } = await make()
    await call(as('editor'), 'PUT', `/${service.id}/items`, { items: [{ songId: SONG_A }] })
    expect((await call(as('editor'), 'DELETE', `/${service.id}`)).status).toBe(200)
    expect((await pg.query('select 1 from service_items')).rows).toHaveLength(0)
  })
})
describe('setlist', () => {
  const put = async (id: string, items: unknown[], who = 'editor') => call(as(who), 'PUT', `/${id}/items`, { items })
  it('keeps order, song titles, the key override and links', async () => {
    const { service } = await make()
    const res = await put(service.id, [
      { songId: SONG_A, key: 'F', links: [{ url: 'https://example.com/v', label: ' Demo ' }] },
      { title: 'Prayer' },
    ])
    expect(res.status).toBe(200)
    const { service: saved } = (await res.json()) as { service: Service }
    expect(saved.items.map((i) => [i.title, i.songId, i.key, i.songKey])).toEqual([['Song A', SONG_A, 'F', 'E'], ['Prayer', null, null, null]])
    expect(saved.items[0].links).toEqual([{ url: 'https://example.com/v', label: 'Demo' }])
    expect(((await (await call(as('member'), 'GET')).json()) as { services: { songs: number }[] }).services[0].songs).toBe(2)
  })
  it('keeps the ids of listed items, reorders, and removes the others', async () => {
    const { service } = await make()
    const first = ((await (await put(service.id, [{ songId: SONG_A }, { title: 'One' }, { title: 'Two' }])).json()) as { service: Service }).service
    const [a, one, two] = first.items
    const next = ((await (await put(service.id, [{ id: two.id, title: 'Two' }, { id: a.id, songId: SONG_A, notes: 'slow' }, { title: 'New' }])).json()) as { service: Service }).service
    expect(next.items.map((i) => i.title)).toEqual(['Two', 'Song A', 'New'])
    expect(next.items[0].id).toBe(two.id)
    expect(next.items[1].id).toBe(a.id)
    expect(next.items.some((i) => i.id === one.id)).toBe(false)
  })
  it('refuses a duplicated line id, another church\'s song, bad links and lines with nothing', async () => {
    const { service } = await make()
    const [x] = ((await (await put(service.id, [{ title: 'One' }])).json()) as { service: Service }).service.items
    expect((await put(service.id, [{ id: x.id, title: 'One' }, { id: x.id, title: 'One' }])).status).toBe(400)
    expect((await put(service.id, [{ songId: SONG_B }])).status).toBe(400)
    for (const url of ['http://example.com', 'javascript:alert(1)', 'not a url']) expect((await put(service.id, [{ songId: SONG_A, links: [{ url }] }])).status).toBe(400)
    expect((await put(service.id, [{}])).status).toBe(400)
    expect((await put(service.id, Array.from({ length: 61 }, () => ({ title: 'x' })))).status).toBe(400)
  })
  it('adds a chart-only song to the list when planning, and refuses a title that exists', async () => {
    const { service } = await make()
    const res = await put(service.id, [{ newSong: { title: 'Brand New', artist: 'Someone', key: 'D' } }])
    expect(res.status).toBe(200)
    const song = (await pg.query<{ id: string; has_stems: boolean; music_key: string; created_by: string }>(`select id, has_stems, music_key, created_by from songs where title = 'Brand New' and organization_id = $1`, [A])).rows[0]
    expect([song.has_stems, song.music_key, song.created_by]).toEqual([false, 'D', 'editor'])
    const { service: saved } = (await res.json()) as { service: Service }
    expect(saved.items[0].songId).toBe(song.id)
    expect((await put(service.id, [{ newSong: { title: 'Song A' } }])).status).toBe(409)
  })
  it('keeps plain items and headers beside songs, and a header has no key, notes or links', async () => {
    const { service } = await make()
    const res = await put(service.id, [
      { kind: 'header', title: 'Before service', key: 'G', notes: 'x', links: [{ url: 'https://example.com' }] },
      { kind: 'item', title: 'Opening prayer', notes: 'Pastor', links: [{ url: 'https://example.com/slides', label: 'Slides' }] },
      { songId: SONG_A },
    ])
    expect(res.status).toBe(200)
    const { service: saved } = (await res.json()) as { service: Service }
    expect(saved.items.map((i) => [i.kind, i.title, i.songId, i.key, i.notes, i.links.length])).toEqual([
      ['header', 'Before service', null, null, null, 0],
      ['item', 'Opening prayer', null, null, 'Pastor', 1],
      ['song', 'Song A', SONG_A, null, null, 0],
    ])
    // only songs count in the list
    expect(((await (await call(as('member'), 'GET')).json()) as { services: { songs: number }[] }).services[0].songs).toBe(1)
    // an item or header must be named, and a song id on one is ignored
    expect((await put(service.id, [{ kind: 'item' }])).status).toBe(400)
    expect((await put(service.id, [{ kind: 'header' }])).status).toBe(400)
    const ignored = (await (await put(service.id, [{ kind: 'item', title: 'Offering', songId: SONG_A }])).json()) as { service: Service }
    expect(ignored.service.items.map((i) => [i.kind, i.songId])).toEqual([['item', null]])
    // a database check backs the API up
    await expect(pg.query(`update service_items set kind = 'other'`)).rejects.toThrow()
  })
  it('takes a song that is only a name, with links, and allows repeated names', async () => {
    const { service } = await make()
    const link = { url: 'https://youtu.be/dQw4w9WgXcQ', label: '' }
    const res = await put(service.id, [{ kind: 'song', title: 'Not In The List', key: 'G', links: [link] }, { kind: 'song', title: 'Not In The List' }, { songId: SONG_A }, { songId: SONG_A }])
    expect(res.status).toBe(200)
    const { service: saved } = (await res.json()) as { service: Service }
    expect(saved.items.map((i) => [i.kind, i.title, i.songId, i.key])).toEqual([['song', 'Not In The List', null, 'G'], ['song', 'Not In The List', null, null], ['song', 'Song A', SONG_A, null], ['song', 'Song A', SONG_A, null]])
    expect(saved.items[0].links).toEqual([link])
    expect((await pg.query(`select count(*)::int n from songs where organization_id = $1`, [A])).rows[0]).toEqual({ n: 1 })
  })
  it('does not add an archived song, but keeps one a line already has', async () => {
    const { service } = await make()
    await put(service.id, [{ songId: SONG_A }])
    await pg.query(`update songs set archived_at = now() where id = $1`, [SONG_A])
    const { service: now } = (await (await call(as('member'), 'GET', `/${service.id}`)).json()) as { service: Service }
    // saving again with the same line is fine; adding the archived song to a new line of another service is not
    expect((await put(service.id, [{ id: now.items[0].id, songId: SONG_A }, { title: 'Prayer', kind: 'item' }])).status).toBe(200)
    const other = (await make({ date: '2031-06-01' })).service
    expect((await put(other.id, [{ songId: SONG_A }])).status).toBe(400)
    // a new song with the title of an archived one says so
    expect(await (await put(other.id, [{ newSong: { title: 'Song A' } }])).json()).toEqual({ error: '“Song A” is in the archive. An admin can restore it.' })
  })
  it('keeps the line when its song is deleted', async () => {
    const { service } = await make()
    await put(service.id, [{ songId: SONG_A }])
    await pg.query('delete from songs where id = $1', [SONG_A])
    const { service: after } = (await (await call(as('member'), 'GET', `/${service.id}`)).json()) as { service: Service }
    expect(after.items.map((i) => [i.kind, i.title, i.songId, i.songKey])).toEqual([['song', 'Song A', null, null]])
    // saving the setlist again does not turn it into a plain item
    const again = (await (await put(service.id, [{ id: after.items[0].id, kind: 'song', title: 'Song A' }])).json()) as { service: Service }
    expect(again.service.items.map((i) => [i.kind, i.title])).toEqual([['song', 'Song A']])
  })
})
