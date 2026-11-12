import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { schema, type Db } from '../src/db/client.ts'

export const MIGRATIONS = 'src/db/migrations'

/** A fresh in-memory Postgres with the app's migrations applied, as Drizzle and as raw PGlite. */
export async function freshDb(): Promise<{ pg: PGlite; db: Db }> {
  const pg = new PGlite()
  const db = drizzle({ client: pg, schema })
  await migrate(db, { migrationsFolder: MIGRATIONS })
  return { pg, db: db as unknown as Db }
}

export async function seedChurch(pg: PGlite, id: string, slug = id) {
  await pg.query('insert into organizations (id, name, slug) values ($1, $2, $3)', [id, slug.toUpperCase(), slug])
}

export async function seedUser(pg: PGlite, id: string, email = `${id}@example.com`) {
  await pg.query('insert into users (id, name, email) values ($1, $2, $3)', [id, id, email])
}

export async function seedMember(pg: PGlite, orgId: string, userId: string, role: string) {
  await pg.query('insert into members (id, organization_id, user_id, role) values ($1, $2, $3, $4)', [`${orgId}-${userId}`, orgId, userId, role])
}

/** A session row (Better Auth's columns), optionally with an active church. */
export async function seedSession(pg: PGlite, id: string, userId: string, activeOrgId: string | null = null) {
  await pg.query(`insert into sessions (id, token, user_id, active_organization_id, expires_at) values ($1, $2, $3, $4, now() + interval '1 day')`, [id, `token-${id}`, userId, activeOrgId])
}
