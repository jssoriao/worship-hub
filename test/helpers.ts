import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import type { Db } from '../worker/data.ts'

/** The Better Auth tables schema.sql depends on, as the Better Auth CLI creates them (trimmed). */
const AUTH_TABLES = `
create table "user" (id text primary key, name text not null, email text not null unique, "emailVerified" boolean not null default false, "createdAt" timestamptz not null default now(), "updatedAt" timestamptz not null default now(), role text default 'member');
create table organization (id text primary key, name text not null, slug text unique, logo text, "createdAt" timestamptz not null default now(), metadata text);
create table member (id text primary key, "organizationId" text not null references organization(id) on delete cascade, "userId" text not null references "user"(id) on delete cascade, role text not null, "createdAt" timestamptz not null default now());
`
export const SCHEMA_SQL = readFileSync('db/schema.sql', 'utf8')

export async function freshDb(): Promise<{ pg: PGlite; db: Db }> {
  const pg = new PGlite()
  await pg.exec(AUTH_TABLES)
  await pg.exec(SCHEMA_SQL)
  const db: Db = { query: async (text, params) => ({ rows: (await pg.query(text, params as unknown[])).rows as never }) }
  return { pg, db }
}

export async function seedChurch(pg: PGlite, id: string, slug = id) {
  await pg.query('insert into organization (id, name, slug) values ($1, $2, $3)', [id, slug.toUpperCase(), slug])
}
export async function seedUser(pg: PGlite, id: string, email = `${id}@example.com`) {
  await pg.query('insert into "user" (id, name, email) values ($1, $2, $3)', [id, id, email])
}
export async function seedMember(pg: PGlite, orgId: string, userId: string, role: string) {
  await pg.query('insert into member (id, "organizationId", "userId", role) values ($1, $2, $3, $4)', [`${orgId}-${userId}`, orgId, userId, role])
}
