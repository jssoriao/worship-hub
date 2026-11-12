/**
 * The database as the Worker and the scripts use it: Drizzle over Neon's serverless driver (a pg-style
 * Pool over WebSockets, which Workers can open). Tests use the same schema on PGlite.
 */
import { Pool, neonConfig } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import * as schema from './schema/index.ts'

export { schema }

/** Any Drizzle Postgres database with this schema (Neon in the Worker and scripts, PGlite in tests). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>

/** A Drizzle database over `pool`. The pool belongs to the caller, who ends it. */
export function dbOver(pool: Pool): Db {
  return drizzle({ client: pool, schema }) as unknown as Db
}

/** A pool and its database, for scripts (Node): `await close()` when done. */
export function openDb(url: string): { db: Db; pool: Pool; close: () => Promise<void> } {
  neonConfig.webSocketConstructor = WebSocket
  const pool = new Pool({ connectionString: url })
  pool.on('error', (error: Error) => console.error('database pool error:', error.message))
  return { db: dbOver(pool), pool, close: () => pool.end() }
}

/** Postgres error code, looking through Drizzle's wrapper (DrizzleQueryError keeps the driver error as `cause`). */
export function pgCode(error: unknown): { code?: string; constraint?: string } {
  const e = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } }
  return e?.code ? e : (e?.cause ?? {})
}

/** True for a unique violation (of `constraint`, when given). */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const e = pgCode(error)
  return e.code === '23505' && (!constraint || e.constraint === constraint)
}
