/**
 * pnpm db:migrate [--target dev|prod]
 *
 * Applies the migrations in src/db/migrations (made by `pnpm db:generate` from src/db/schema) that the
 * database has not had yet; drizzle records each one in drizzle.__drizzle_migrations. Uses the owner
 * login (DATABASE_OWNER_URL), because migrations create and alter tables. Runs before every deploy, so
 * a migration must also work with the Worker version that is still live (additive changes).
 */
import { fileURLToPath } from 'node:url'
import { Pool, neonConfig } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import { migrate } from 'drizzle-orm/neon-serverless/migrator'
import { loadTarget, splitTarget } from './lib/env.ts'

const { target } = splitTarget(process.argv.slice(2))
const url = loadTarget(target)
neonConfig.webSocketConstructor = WebSocket
const pool = new Pool({ connectionString: url })
try {
  await migrate(drizzle({ client: pool }), { migrationsFolder: fileURLToPath(new URL('../db/migrations', import.meta.url)) })
  console.log(`Migrations applied (${target}).`)
} finally {
  await pool.end()
}
