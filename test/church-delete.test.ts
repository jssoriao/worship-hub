import { beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import type { Db } from '../src/api/data.ts'
import type { ObjectStore, R2Entry } from '../src/cli/lib/r2.ts'
import { churchPrefix, deleteChurch, describePlan, planChurchDelete, type ChurchRef } from '../src/cli/lib/church-delete.ts'
import { freshDb, seedChurch, seedMember, seedUser } from './helpers.ts'

/** An in-memory bucket; `failDeletesAfter` makes deletes start failing, like a dropped connection. */
class MemoryStore implements ObjectStore {
  objects = new Map<string, number>()
  failDeletesAfter = Infinity
  deletes = 0
  add(key: string, size = 10) {
    this.objects.set(key, size)
  }
  async list(prefix: string): Promise<R2Entry[]> {
    return [...this.objects].filter(([k]) => k.startsWith(prefix)).map(([key, size]) => ({ key, size, etag: 'x' }))
  }
  async read() {
    return null
  }
  async copy() {}
  async delete(key: string) {
    if (this.deletes >= this.failDeletesAfter) throw new Error(`could not delete ${key}`)
    this.deletes++
    this.objects.delete(key)
  }
}

const A = 'churchaaaaaa'
const B = 'churchbbbbbb'
const church: ChurchRef = { id: A, slug: 'church-a', name: 'Church A' }
const rows = async (db: Db, sql: string) => Number((await db.query<{ n: number }>(sql)).rows[0].n)

let pg: PGlite
let db: Db
let store: MemoryStore

beforeEach(async () => {
  ;({ pg, db } = await freshDb())
  await pg.exec(`create table session (id text primary key, token text, "userId" text, "activeOrganizationId" text)`)
  await seedChurch(pg, A, 'church-a')
  await seedChurch(pg, B, 'church-b')
  await seedUser(pg, 'u1')
  await seedUser(pg, 'u2')
  await seedMember(pg, A, 'u1', 'owner')
  await seedMember(pg, A, 'u2', 'member')
  await seedMember(pg, B, 'u2', 'member') // u2 is also in church B
  await pg.query(`insert into song (id, "organizationId", title) values ('songaaaaaaa1', $1, 'Song A'), ('songbbbbbbb1', $2, 'Song B')`, [A, B])
  await pg.query(`insert into arrangement (id, "songId", owner, name, data) values ('arr1', 'songaaaaaaa1', 'u1', 'Sunday', '{}')`)
  await pg.query(`insert into session (id, token, "userId", "activeOrganizationId") values ('s1', 't1', 'u1', $1), ('s2', 't2', 'u2', $2)`, [A, B])
  store = new MemoryStore()
  for (let i = 0; i < 5; i++) store.add(`${churchPrefix(A)}songs/songaaaaaaa1/stems/s${i}.mp3`, 100)
  store.add(`${churchPrefix(B)}songs/songbbbbbbb1/stems/b.mp3`, 100)
})

describe('pnpm churches delete', () => {
  it('plans without changing anything', async () => {
    const plan = await planChurchDelete(db, store, church)
    expect(plan).toMatchObject({ members: 2, peopleLeftWithoutChurch: 1, songs: 1, arrangements: 1, sessions: 1, files: { count: 5, bytes: 500 } })
    expect(describePlan(plan).join('\n')).toContain(A)
    expect(store.objects.size).toBe(6)
    expect(await rows(db, 'select count(*)::int n from organization')).toBe(2)
  })

  it('deletes the files first, then the rows, and leaves other churches alone', async () => {
    const r = await deleteChurch(db, store, church)
    expect(r.filesDeleted).toBe(5)
    expect([...store.objects.keys()]).toEqual([`${churchPrefix(B)}songs/songbbbbbbb1/stems/b.mp3`])
    expect(await rows(db, `select count(*)::int n from organization where id = '${A}'`)).toBe(0)
    expect(await rows(db, `select count(*)::int n from song where "organizationId" = '${A}'`)).toBe(0)
    expect(await rows(db, `select count(*)::int n from arrangement`)).toBe(0)
    expect(await rows(db, `select count(*)::int n from member where "organizationId" = '${A}'`)).toBe(0)
    expect(await rows(db, `select count(*)::int n from session where "activeOrganizationId" is null`)).toBe(1)
    // church B is untouched
    expect(await rows(db, `select count(*)::int n from song where "organizationId" = '${B}'`)).toBe(1)
    expect(await rows(db, `select count(*)::int n from member where "organizationId" = '${B}'`)).toBe(1)
    expect(await rows(db, `select count(*)::int n from session where "activeOrganizationId" = '${B}'`)).toBe(1)
  })

  it('keeps every row when deleting files fails, and finishes when run again', async () => {
    store.failDeletesAfter = 2
    await expect(deleteChurch(db, store, church)).rejects.toThrow(/could not delete/)
    expect((await store.list(churchPrefix(A))).length).toBe(3)
    expect(await rows(db, `select count(*)::int n from organization where id = '${A}'`)).toBe(1)
    expect(await rows(db, `select count(*)::int n from song where "organizationId" = '${A}'`)).toBe(1)
    // the connection is back: the same command carries on
    store.failDeletesAfter = Infinity
    const r = await deleteChurch(db, store, church)
    expect(r.filesDeleted).toBe(3)
    expect((await store.list(churchPrefix(A))).length).toBe(0)
    expect(await rows(db, `select count(*)::int n from organization where id = '${A}'`)).toBe(0)
  })

  it('without a store (the dev database) deletes rows and never touches files', async () => {
    const plan = await planChurchDelete(db, null, church)
    expect(plan.files).toBeNull()
    expect(describePlan(plan).join('\n')).toContain('not touched')
    const r = await deleteChurch(db, null, church)
    expect(r.filesDeleted).toBe(0)
    expect(store.objects.size).toBe(6)
    expect(await rows(db, `select count(*)::int n from organization where id = '${A}'`)).toBe(0)
  })
})
