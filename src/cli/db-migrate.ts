/**
 * pnpm db:migrate [--target dev|prod]
 * 1. Better Auth tables (user, session, organization, member, ...) via the Better Auth CLI.
 * 2. src/db/schema.sql: song, arrangement and friends (idempotent, additive).
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { Pool, neonConfig } from '@neondatabase/serverless'
import { loadTarget, splitTarget } from './lib/env.ts'

const { target } = splitTarget(process.argv.slice(2))
const url = loadTarget(target)

const auth = spawnSync('pnpm', ['exec', 'auth', 'migrate', '--config', 'src/cli/auth-cli.ts', '-y'], { stdio: 'inherit', env: process.env })
if (auth.status !== 0) process.exit(auth.status ?? 1)

neonConfig.webSocketConstructor = WebSocket
const pool = new Pool({ connectionString: url })
try {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'))
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
  console.log(`schema.sql applied (${target})`)
} finally {
  await pool.end()
}
