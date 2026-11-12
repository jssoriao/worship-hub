/**
 * pnpm db:app-role [--target dev|prod] [--keep-password]
 *
 * Creates the app's database role, `worship_hub_worker`, or gives it a new password, and grants it
 * data access only: select, insert, update and delete on the app's tables (and the same on tables
 * that later migrations add). It cannot create, alter or drop anything. Then it writes the role's
 * pooled connection string into DATABASE_URL of the target's vars file (.dev.vars or .prod.vars).
 * The password is never printed.
 *
 * The role is made with SQL on purpose: Neon gives roles made in its console membership of
 * neon_superuser (create databases and roles, read and write everything), which the owner cannot
 * take away. Roles are per branch (every database on the branch shares them), so run this once per
 * branch and database.
 *
 * --keep-password grants on the database in DATABASE_OWNER_URL without changing the role's password,
 * so a Worker still connected with the old password keeps working (moving to another database). It
 * writes DATABASE_URL with the password already in the vars file.
 *
 * For production, set the Worker secret afterwards:
 *   pnpm exec wrangler secret put DATABASE_URL     (paste the DATABASE_URL value from .prod.vars)
 */
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { Client, neonConfig } from '@neondatabase/serverless'
import { loadTarget, splitTarget } from './lib/env.ts'

const ROLE = 'worship_hub_worker'
const { target, rest } = splitTarget(process.argv.slice(2))
const keepPassword = rest.includes('--keep-password')
const ownerUrl = loadTarget(target)
const file = target === 'prod' ? '.prod.vars' : '.dev.vars'

neonConfig.webSocketConstructor = WebSocket
// role changes need a direct session, not the pooler
const db = new Client({ connectionString: ownerUrl.replace('-pooler.', '.') })
await db.connect()
try {
  const database = (await db.query<{ d: string }>('select current_database() as d')).rows[0].d
  const owner = (await db.query<{ u: string }>('select current_user as u')).rows[0].u
  const exists = (await db.query('select 1 from pg_roles where rolname = $1', [ROLE])).rows.length > 0
  const text = readFileSync(file, 'utf8')
  let password: string
  if (keepPassword) {
    const current = /^DATABASE_URL=(.*)$/m.exec(text)?.[1]?.trim().replace(/^"|"$/g, '')
    const kept = current ? new URL(current) : null
    if (!exists || !kept || decodeURIComponent(kept.username) !== ROLE || !kept.password) {
      throw new Error(`--keep-password needs ${ROLE} to exist and DATABASE_URL in ${file} to hold its password`)
    }
    password = decodeURIComponent(kept.password)
  } else {
    // URL-safe and far beyond Neon's 60-bit minimum; the suffix guarantees mixed character types
    password = `${randomBytes(24).toString('base64url')}Aa1-`
    // CREATE/ALTER ROLE take no bind parameters; the password is generated here, never user input
    await db.query(`${exists ? 'alter' : 'create'} role ${ROLE} with login password '${password}'`)
  }
  for (const sql of [
    `revoke all on database "${database}" from ${ROLE}`,
    `grant connect on database "${database}" to ${ROLE}`,
    `revoke create on schema public from ${ROLE}`,
    `grant usage on schema public to ${ROLE}`,
    `grant select, insert, update, delete on all tables in schema public to ${ROLE}`,
    `grant usage, select on all sequences in schema public to ${ROLE}`,
    `alter default privileges for role "${owner}" in schema public grant select, insert, update, delete on tables to ${ROLE}`,
    `alter default privileges for role "${owner}" in schema public grant usage, select on sequences to ${ROLE}`,
  ])
    await db.query(sql)

  const powers = (await db.query<Record<string, boolean>>('select rolsuper, rolcreatedb, rolcreaterole, rolbypassrls from pg_roles where rolname = $1', [ROLE])).rows[0]
  const groups = (await db.query('select 1 from pg_auth_members m join pg_roles u on u.oid = m.member where u.rolname = $1', [ROLE])).rows.length
  if (Object.values(powers).some(Boolean) || groups > 0) throw new Error(`${ROLE} has more than data access; delete it and run this again`)

  const app = new URL(ownerUrl)
  app.username = ROLE
  app.password = password
  const line = `DATABASE_URL=${app.toString()}`
  const next = /^DATABASE_URL=.*$/m.test(text) ? text.replace(/^DATABASE_URL=.*$/m, line) : `${text.trimEnd()}\n${line}\n`
  writeFileSync(file, next)
  console.log(`${keepPassword ? 'Granted' : exists ? 'New password for' : 'Created'} ${ROLE} on ${target}, database ${database} (data access only); DATABASE_URL in ${file} updated.`)
  if (target === 'prod' && !keepPassword) console.log('Now update the Worker: pnpm exec wrangler secret put DATABASE_URL (the value from .prod.vars).')
} finally {
  await db.end()
}
