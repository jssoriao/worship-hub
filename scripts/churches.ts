/**
 * Manage churches (tenants). A church is a Better Auth organization; only this script makes them.
 *
 *   pnpm churches list
 *   pnpm churches add <slug> <name> [--owner <email>]
 *   pnpm churches rename <slug> <name>
 *   pnpm churches delete <slug> --confirm <slug>      deletes its songs, members' links and (with --target prod) its R2 files
 *
 * Add --target prod to act on the production database (default is the Neon dev database).
 */
import { Pool, neonConfig } from '@neondatabase/serverless'
import { newId } from '../shared/ids.ts'
import { normalizeEmail, parseArgs, parseSlug } from './lib/cli.ts'
import { loadTarget, splitTarget } from './lib/env.ts'
import { WranglerStore } from './lib/r2.ts'
import { churchBySlug } from './lib/songs-db.ts'

const BUCKET = 'worship-hub'
const { target, rest } = splitTarget(process.argv.slice(2))
const { positional, flags } = parseArgs(rest, ['owner', 'confirm'])
const [command, ...args] = positional
const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}
if (!['list', 'add', 'rename', 'delete'].includes(command ?? '')) {
  fail('Usage:\n  pnpm churches list\n  pnpm churches add <slug> <name> [--owner <email>]\n  pnpm churches rename <slug> <name>\n  pnpm churches delete <slug> --confirm <slug>\n(add --target prod for production)')
}
neonConfig.webSocketConstructor = WebSocket
const pool = new Pool({ connectionString: loadTarget(target) })
try {
  if (command === 'list') {
    const { rows } = await pool.query(
      `select o.slug, o.name, o.id, (select count(*) from member m where m."organizationId" = o.id)::int as members, (select count(*) from song s where s."organizationId" = o.id)::int as songs
         from organization o order by o."createdAt"`,
    )
    if (rows.length === 0) console.log('No churches yet.')
    for (const r of rows) console.log(`${r.slug}\t${r.name}\t${r.members} members\t${r.songs} songs\t${r.id}`)
  } else if (command === 'add') {
    const slug = parseSlug(args[0])
    const name = args.slice(1).join(' ').trim() || fail('Give the church a name: pnpm churches add <slug> <name>')
    if (await churchBySlug(pool, slug)) fail(`There is a church "${slug}" already.`)
    const id = newId()
    await pool.query('insert into organization (id, name, slug, "createdAt") values ($1, $2, $3, now())', [id, name, slug])
    console.log(`Added church ${slug} (${name}), id ${id}.`)
    if (typeof flags.owner === 'string') {
      const email = normalizeEmail(flags.owner)
      const user = await pool.query<{ id: string }>('select id from "user" where email = $1', [email])
      const userId = user.rows[0]?.id ?? crypto.randomUUID()
      if (!user.rows[0]) {
        await pool.query(`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values ($1, $2, $3, true, now(), now())`, [userId, email.split('@')[0], email])
      }
      await pool.query(`insert into member (id, "organizationId", "userId", role, "createdAt") values ($1, $2, $3, 'owner', now())`, [crypto.randomUUID(), id, userId])
      console.log(`${email} is the owner.`)
    }
  } else if (command === 'rename') {
    const church = (await churchBySlug(pool, parseSlug(args[0]))) ?? fail('No such church.')
    const name = args.slice(1).join(' ').trim() || fail('Give the new name.')
    await pool.query('update organization set name = $1 where id = $2', [name, church.id])
    console.log(`Renamed ${church.slug} to ${name}.`)
  } else if (command === 'delete') {
    const slug = parseSlug(args[0])
    if (flags.confirm !== slug) fail(`This deletes the church, all its songs and arrangements. Repeat the slug to confirm: pnpm churches delete ${slug} --confirm ${slug}`)
    const church = (await churchBySlug(pool, slug)) ?? fail('No such church.')
    // sessions pointing at it would otherwise keep an active church that no longer exists
    await pool.query('update session set "activeOrganizationId" = null where "activeOrganizationId" = $1', [church.id])
    await pool.query('delete from organization where id = $1', [church.id]) // songs, arrangements, members go with it
    console.log(`Deleted church ${slug} from the ${target} database.`)
    if (target === 'prod') {
      const store = new WranglerStore(BUCKET)
      try {
        const objects = await store.list(`churches/${church.id}/`)
        for (const o of objects) await store.delete(o.key)
        console.log(`Deleted ${objects.length} file(s) from R2.`)
      } finally {
        store.close()
      }
    } else {
      console.log('R2 was not touched (only --target prod deletes files).')
    }
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
} finally {
  await pool.end()
}
