/**
 * ONE-OFF (stack refactor, #21): copies everything from the old database (camelCase columns, singular
 * tables, made by Better Auth's migrate and schema.sql) into the new one (snake_case, plural, made by
 * the Drizzle migrations). Delete this file once production runs on the new database.
 *
 *   pnpm db:move --from neondb [--target dev|prod] [--replace]
 *
 * The new database is the one in DATABASE_OWNER_URL; the old one is the same server with `--from` as
 * the database name. The old database is only read (in a read-only transaction). The new one must have
 * its migrations applied and be empty, unless --replace (which empties it first). Everything is written
 * in one transaction, then every table's row count is compared. Sign-in codes and rate-limit counters
 * are not copied (they expire within minutes); sessions are, so people stay signed in.
 */
import { Client, neonConfig } from '@neondatabase/serverless'
import { loadTarget, splitTarget } from './lib/env.ts'
import { parseArgs } from './lib/cli.ts'

const { target, rest } = splitTarget(process.argv.slice(2))
const { flags } = parseArgs(rest, ['from'])
const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}
const from = typeof flags.from === 'string' ? flags.from : fail('Usage: pnpm db:move --from <old database name> [--target dev|prod] [--replace]')
if (!/^[a-z_][a-z0-9_]*$/.test(from)) fail('--from must be a plain database name')

/** Old table -> new table, in an order that respects foreign keys. */
const TABLES: [string, string][] = [
  ['user', 'users'],
  ['organization', 'organizations'],
  ['account', 'accounts'],
  ['session', 'sessions'],
  ['member', 'members'],
  ['invitation', 'invitations'],
  ['song', 'songs'],
  ['arrangement', 'arrangements'],
]
/** Columns whose new name is not just snake_case of the old one. */
const RENAMED: Record<string, Record<string, string>> = { arrangement: { owner: 'owner_id' } }
const snake = (name: string) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)

const newUrl = loadTarget(target).replace('-pooler.', '.')
const oldUrl = (() => {
  const u = new URL(newUrl)
  u.pathname = `/${from}`
  return u.toString()
})()
if (new URL(newUrl).pathname === `/${from}`) fail('--from is the database in DATABASE_OWNER_URL itself')

neonConfig.webSocketConstructor = WebSocket
const source = new Client({ connectionString: oldUrl })
const dest = new Client({ connectionString: newUrl })
await source.connect()
await dest.connect()

const columnsOf = async (client: Client, table: string) =>
  (await client.query<{ c: string }>(`select column_name c from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`, [table])).rows.map((r) => r.c)
const count = async (client: Client, table: string) => Number((await client.query<{ n: string }>(`select count(*) n from "${table}"`)).rows[0].n)

try {
  for (const [, to] of TABLES) if ((await columnsOf(dest, to)).length === 0) fail(`The new database has no "${to}" table. Run pnpm db:migrate${target === 'prod' ? ' --target prod' : ''} first.`)
  const filled = []
  for (const [, to] of TABLES) if ((await count(dest, to)) > 0) filled.push(to)
  if (filled.length && rest.includes('--replace') === false) fail(`The new database already has rows in ${filled.join(', ')}. Add --replace to empty it first.`)

  await source.query('begin transaction isolation level repeatable read read only')
  const plan: { from: string; to: string; columns: [string, string][]; rows: Record<string, unknown>[] }[] = []
  for (const [fromTable, to] of TABLES) {
    const oldCols = await columnsOf(source, fromTable)
    if (oldCols.length === 0) {
      console.log(`  ${fromTable}: not in the old database, skipped`)
      continue
    }
    const newCols = new Set(await columnsOf(dest, to))
    const columns: [string, string][] = []
    for (const c of oldCols) {
      const mapped = RENAMED[fromTable]?.[c] ?? snake(c)
      if (newCols.has(mapped)) columns.push([c, mapped])
      else fail(`${fromTable}.${c} has no place in ${to} (looked for ${mapped}); nothing was written`)
    }
    const { rows } = await source.query<Record<string, unknown>>(`select * from "${fromTable}"`)
    plan.push({ from: fromTable, to, columns, rows })
  }
  await source.query('commit')

  await dest.query('begin')
  try {
    if (filled.length) await dest.query(`truncate ${TABLES.map(([, t]) => `"${t}"`).join(', ')} cascade`)
    for (const { to, columns, rows } of plan) {
      const names = columns.map(([, n]) => `"${n}"`).join(', ')
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200)
        const params: unknown[] = []
        const values = chunk.map((row) => `(${columns.map(([c]) => (params.push(row[c] instanceof Object && !(row[c] instanceof Date) ? JSON.stringify(row[c]) : row[c]), `$${params.length}`)).join(', ')})`)
        await dest.query(`insert into "${to}" (${names}) values ${values.join(', ')}`, params)
      }
    }
    await dest.query('commit')
  } catch (error) {
    await dest.query('rollback')
    throw error
  }

  let ok = true
  for (const { from: f, to, rows } of plan) {
    const n = await count(dest, to)
    const same = n === rows.length
    ok &&= same
    console.log(`  ${f} -> ${to}: ${rows.length} row(s) copied, ${n} in the new database${same ? '' : '  <-- MISMATCH'}`)
  }
  if (!ok) fail('Row counts differ. The old database is untouched; run again with --replace after fixing the cause.')
  console.log(`Copied ${from} into ${new URL(newUrl).pathname.slice(1)} (${target}). The old database was only read.`)
} finally {
  await source.end().catch(() => {})
  await dest.end().catch(() => {})
}
