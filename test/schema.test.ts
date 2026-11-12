import { describe, expect, it } from 'vitest'
import { freshDb, SCHEMA_SQL, seedChurch, seedUser } from './helpers.ts'

describe('src/db/schema.sql', () => {
  it('is idempotent', async () => {
    const { pg } = await freshDb()
    await pg.exec(SCHEMA_SQL)
    await pg.exec(SCHEMA_SQL)
    const { rows } = await pg.query<{ table_name: string }>("select table_name from information_schema.tables where table_name in ('song','arrangement')")
    expect(rows.map((r) => r.table_name).sort()).toEqual(['arrangement', 'song'])
  })
  it('makes platformAdmin default false and not null', async () => {
    const { pg } = await freshDb()
    await seedUser(pg, 'u1')
    const { rows } = await pg.query<{ platformAdmin: boolean }>('select "platformAdmin" from "user"')
    expect(rows[0].platformAdmin).toBe(false)
  })
  it('titles are unique per church only', async () => {
    const { pg } = await freshDb()
    await seedChurch(pg, 'a')
    await seedChurch(pg, 'b')
    const ins = (id: string, org: string) => pg.query('insert into song (id, "organizationId", title) values ($1, $2, $3)', [id, org, 'Song A'])
    await ins('s1', 'a')
    await ins('s2', 'b')
    await expect(ins('s3', 'a')).rejects.toThrow()
  })
  it('deleting a church removes its songs and their arrangements', async () => {
    const { pg } = await freshDb()
    await seedChurch(pg, 'a')
    await pg.query(`insert into song (id, "organizationId", title) values ('s1','a','T')`)
    await pg.query(`insert into arrangement (id, "songId", name, data) values ('r1','s1','x','{}')`)
    await pg.query(`delete from organization where id = 'a'`)
    expect((await pg.query('select 1 from song')).rows).toHaveLength(0)
    expect((await pg.query('select 1 from arrangement')).rows).toHaveLength(0)
  })
  it('deleting a user keeps their songs and arrangements (owner becomes null)', async () => {
    const { pg } = await freshDb()
    await seedChurch(pg, 'a')
    await seedUser(pg, 'u1')
    await pg.query(`insert into song (id, "organizationId", title, "createdBy") values ('s1','a','T','u1')`)
    await pg.query(`insert into arrangement (id, "songId", owner, name, data) values ('r1','s1','u1','x','{}')`)
    await pg.query(`delete from "user" where id = 'u1'`)
    expect((await pg.query<{ owner: string | null }>('select owner from arrangement')).rows[0].owner).toBeNull()
    expect((await pg.query('select 1 from song')).rows).toHaveLength(1)
  })
})
