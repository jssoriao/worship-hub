import { beforeEach, describe, expect, it } from 'vitest'
import type { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import type { Db } from '../src/db/client.ts'
import type { ObjectStore, R2Entry } from '../src/cli/lib/r2.ts'
import { deleteSong, describeSongDelete, findSong, songFolder } from '../src/cli/lib/song-delete.ts'
import { freshDb, seedChurch, seedUser } from './helpers.ts'

class MemoryStore implements ObjectStore {
  objects = new Map<string, number>()
  failDeletesAfter = Infinity
  deletes = 0
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
const A = 'org_aaaaaaaaaaaaaaaaaaaaaaaa'
const ONE = 'song_aaaaaaaaaaaaaaaaaaaaaaa1'
const TWO = 'song_aaaaaaaaaaaaaaaaaaaaaaa2'
const count = async (db: Db, query: string) => Number(((await db.execute(sql.raw(query))) as unknown as { rows: { n: number }[] }).rows[0].n)
let pg: PGlite
let db: Db
let store: MemoryStore

beforeEach(async () => {
  ;({ pg, db } = await freshDb())
  await seedChurch(pg, A, 'a')
  await seedUser(pg, 'u1')
  await pg.query(`insert into songs (id, organization_id, title, archived_at) values ($1, $2, 'First', now()), ($3, $2, 'Second', null)`, [ONE, A, TWO])
  await pg.query(`insert into arrangements (id, song_id, owner_id, name, data) values ('arr1', $1, 'u1', 'Sunday', '{}')`, [ONE])
  store = new MemoryStore()
  for (const f of ['stems/manifest.json', 'stems/a.mp3', 'analysis.json', 'analysis/history/2026.json']) store.objects.set(`${songFolder(A, ONE)}${f}`, 1_048_576)
  store.objects.set(`${songFolder(A, TWO)}stems/manifest.json`, 5)
})

describe('finding the song to delete', () => {
  it('needs the exact title, and says whether it is archived', async () => {
    expect(await findSong(db, A, 'First')).toEqual({ id: ONE, title: 'First', archived: true })
    expect(await findSong(db, A, 'Second')).toMatchObject({ archived: false })
    expect(await findSong(db, A, 'first')).toBeNull()
    expect(await findSong(db, A, 'Nope')).toBeNull()
  })
})

describe('describing a delete', () => {
  it('lists what would go and warns about a song that is not archived, without deleting anything', async () => {
    const lines = await describeSongDelete(db, store, A, (await findSong(db, A, 'First'))!)
    expect(lines.join('\n')).toContain('arrangements: 1')
    expect(lines.join('\n')).toContain('4 (4.0 MB)')
    expect((await describeSongDelete(db, store, A, (await findSong(db, A, 'Second'))!))[0]).toContain('NOT archived')
    expect(await describeSongDelete(db, null, A, (await findSong(db, A, 'First'))!)).toContain('  R2 files:     not touched (only --target prod deletes files)')
    expect(store.objects.size).toBe(5)
  })
})

describe('deleting a song', () => {
  it('removes its files and row and arrangements, and nothing of another song', async () => {
    expect(await deleteSong(db, store, A, (await findSong(db, A, 'First'))!)).toBe(4)
    expect([...store.objects.keys()]).toEqual([`${songFolder(A, TWO)}stems/manifest.json`])
    expect(await count(db, `select count(*)::int as n from songs where id = '${ONE}'`)).toBe(0)
    expect(await count(db, `select count(*)::int as n from arrangements`)).toBe(0)
    expect(await count(db, `select count(*)::int as n from songs where id = '${TWO}'`)).toBe(1)
  })

  it('without a store (the dev database) deletes only the row', async () => {
    expect(await deleteSong(db, null, A, (await findSong(db, A, 'First'))!)).toBe(0)
    expect(store.objects.size).toBe(5)
    expect(await findSong(db, A, 'First')).toBeNull()
  })

  it('stops with the row still there when a file cannot be deleted, and a second run finishes', async () => {
    const song = (await findSong(db, A, 'First'))!
    store.failDeletesAfter = 2
    await expect(deleteSong(db, store, A, song)).rejects.toThrow('could not delete')
    expect(await findSong(db, A, 'First')).not.toBeNull()
    store.failDeletesAfter = Infinity
    expect(await deleteSong(db, store, A, song)).toBe(2)
    expect(await findSong(db, A, 'First')).toBeNull()
  })
})
