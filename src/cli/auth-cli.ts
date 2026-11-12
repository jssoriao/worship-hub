/**
 * Config for the Better Auth CLI, used by `pnpm db:migrate`.
 * It reuses the Worker's options, so the tables it creates always match what production runs.
 * Uses the owner login, DATABASE_OWNER_URL (set by `pnpm db:migrate` for its target; else from .dev.vars).
 */
import { Pool, neonConfig } from '@neondatabase/serverless'
import { betterAuth } from 'better-auth'
import { PostgresDialect, type PostgresPool } from 'kysely'
import { routeLocalDb } from '../shared/local-neon.ts'
import { authOptions } from '../api/auth-options.ts'

try {
  process.loadEnvFile('.dev.vars')
} catch {
  // no .dev.vars: rely on variables already in the environment
}

// Node has no sockets-over-WebSocket transport built in; Neon's driver needs one
neonConfig.webSocketConstructor = WebSocket
routeLocalDb(neonConfig, process.env.DATABASE_OWNER_URL)

const pool = new Pool({ connectionString: process.env.DATABASE_OWNER_URL })

export const auth = betterAuth(
  authOptions({
    baseURL: process.env.APP_URL ?? 'http://127.0.0.1:8787',
    secret: process.env.BETTER_AUTH_SECRET || 'schema-migrations-only-this-secret-is-never-used-to-sign',
    dialect: new PostgresDialect({ pool: pool as unknown as PostgresPool }),
    sendCode: () => {},
    background: () => {},
  }),
)
