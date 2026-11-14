import { describe, expect, it } from 'vitest'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { drizzle } from 'drizzle-orm/pglite'
import { freshDb, MIGRATIONS, seedChurch, seedUser } from './helpers.ts'

describe('migrations (src/db/migrations)', () => {
  it('create every table, snake_case, and running them again changes nothing', async () => {
    const { pg } = await freshDb()
    await migrate(drizzle({ client: pg }), { migrationsFolder: MIGRATIONS })
    const { rows } = await pg.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = 'public' order by 1")
    expect(rows.map((r) => r.table_name)).toEqual(['accounts', 'arrangements', 'invitations', 'join_links', 'join_requests', 'members', 'organizations', 'rate_limits', 'service_items', 'services', 'sessions', 'songs', 'users', 'verifications'])
    const cols = await pg.query<{ column_name: string }>("select column_name from information_schema.columns where table_schema = 'public'")
    for (const { column_name } of cols.rows) expect(column_name).toMatch(/^[a-z][a-z0-9_]*$/)
  })
  it('makes platform_admin false by default', async () => {
    const { pg } = await freshDb()
    await seedUser(pg, 'u1')
    const { rows } = await pg.query<{ platform_admin: boolean }>('select platform_admin from users')
    expect(rows[0].platform_admin).toBe(false)
  })
  it('titles are unique per church only, and a person is in a church once', async () => {
    const { pg } = await freshDb()
    await seedChurch(pg, 'a')
    await seedChurch(pg, 'b')
    await seedUser(pg, 'u1')
    const song = (id: string, org: string) => pg.query('insert into songs (id, organization_id, title) values ($1, $2, $3)', [id, org, 'Song A'])
    await song('s1', 'a')
    await song('s2', 'b')
    await expect(song('s3', 'a')).rejects.toThrow()
    const member = (id: string) => pg.query(`insert into members (id, organization_id, user_id, role) values ($1, 'a', 'u1', 'member')`, [id])
    await member('m1')
    await expect(member('m2')).rejects.toThrow()
  })
  it('deleting a church removes its songs and their arrangements', async () => {
    const { pg } = await freshDb()
    await seedChurch(pg, 'a')
    await pg.query(`insert into songs (id, organization_id, title) values ('s1','a','T')`)
    await pg.query(`insert into arrangements (id, song_id, name, data) values ('r1','s1','x','{}')`)
    await pg.query(`delete from organizations where id = 'a'`)
    expect((await pg.query('select 1 from songs')).rows).toHaveLength(0)
    expect((await pg.query('select 1 from arrangements')).rows).toHaveLength(0)
  })
  it('deleting a user keeps their songs and arrangements (the owner becomes null)', async () => {
    const { pg } = await freshDb()
    await seedChurch(pg, 'a')
    await seedUser(pg, 'u1')
    await pg.query(`insert into songs (id, organization_id, title, created_by) values ('s1','a','T','u1')`)
    await pg.query(`insert into arrangements (id, song_id, owner_id, name, data) values ('r1','s1','u1','x','{}')`)
    await pg.query(`delete from users where id = 'u1'`)
    expect((await pg.query<{ owner_id: string | null }>('select owner_id from arrangements')).rows[0].owner_id).toBeNull()
    expect((await pg.query('select 1 from songs')).rows).toHaveLength(1)
  })
})
