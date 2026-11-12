/**
 * Manage who may sign in, and in which church. People are `user` rows; their church and role is a `member` row.
 * Nobody signs up themselves. Roles: member, editor, admin, owner (see shared/permissions.ts).
 *
 *   pnpm members list [--church <slug>]
 *   pnpm members add <email> [name] --church <slug> --role <role>    adds the person (and the church link), or changes their role
 *   pnpm members remove <email> --church <slug>                      leaves that church; a person with no church left is removed
 *   pnpm members platform-admin <email> [--revoke]                   the platform super admin: runs Music.AI, outside any church
 *
 * Add --target prod to act on the production database (default is the Neon dev database).
 * A removed person's open session works for up to 30 seconds on songs and 5 minutes elsewhere (cookie cache).
 */
import { Pool, neonConfig } from '@neondatabase/serverless'
import { normalizeEmail, parseArgs, parseRole, parseSlug } from './lib/cli.ts'
import { loadTarget, splitTarget } from './lib/env.ts'
import { churchBySlug } from './lib/songs-db.ts'

const { target, rest } = splitTarget(process.argv.slice(2))
const { positional, flags } = parseArgs(rest, ['church', 'role'])
const [command, ...args] = positional
const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}
if (!['list', 'add', 'remove', 'platform-admin'].includes(command ?? '')) {
  fail(
    'Usage:\n  pnpm members list [--church <slug>]\n  pnpm members add <email> [name] --church <slug> --role member|editor|admin|owner\n  pnpm members remove <email> --church <slug>\n  pnpm members platform-admin <email> [--revoke]\n(add --target prod for production)',
  )
}
neonConfig.webSocketConstructor = WebSocket
const pool = new Pool({ connectionString: loadTarget(target) })

async function churchOf(): Promise<{ id: string; slug: string; name: string }> {
  const slug = typeof flags.church === 'string' ? flags.church : ''
  if (!slug) return fail('Say which church: --church <slug> (pnpm churches list)')
  return (await churchBySlug(pool, parseSlug(slug))) ?? fail(`No church "${slug}". pnpm churches list`)
}

try {
  if (command === 'list') {
    const church = typeof flags.church === 'string' ? await churchOf() : null
    const { rows } = await pool.query(
      `select u.email, u.name, u."platformAdmin" as platform, o.slug, m.role
         from "user" u left join member m on m."userId" = u.id left join organization o on o.id = m."organizationId"
        where ($1::text is null or o.id = $1) order by u."createdAt", o.slug`,
      [church?.id ?? null],
    )
    if (rows.length === 0) console.log('No members yet.')
    for (const r of rows) console.log(`${r.email}\t${r.slug ?? '(no church)'}\t${r.role ?? '-'}\t${r.platform ? 'platform admin' : ''}\t${r.name}`)
  } else if (command === 'add') {
    const email = normalizeEmail(args[0])
    const name = args[1] ?? email.split('@')[0]
    const role = parseRole(flags.role)
    const church = await churchOf()
    const client = await pool.connect()
    try {
      await client.query('begin')
      // Better Auth looks people up by email; emailVerified is true because only invited people exist here
      const user = await client.query<{ id: string }>(
        `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
         values ($1, $2, $3, true, now(), now())
         on conflict (email) do update set "updatedAt" = now() returning id`,
        [crypto.randomUUID(), name, email],
      )
      const userId = user.rows[0].id
      const existing = await client.query('select id from member where "organizationId" = $1 and "userId" = $2', [church.id, userId])
      if (existing.rows[0]) await client.query('update member set role = $1 where id = $2', [role, existing.rows[0].id])
      else await client.query(`insert into member (id, "organizationId", "userId", role, "createdAt") values ($1, $2, $3, $4, now())`, [crypto.randomUUID(), church.id, userId, role])
      await client.query('commit')
      console.log(`${existing.rows[0] ? 'Updated' : 'Added'} ${email} in ${church.slug} as ${role}.`)
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  } else if (command === 'remove') {
    const email = normalizeEmail(args[0])
    const church = await churchOf()
    const client = await pool.connect()
    try {
      await client.query('begin')
      const found = await client.query<{ id: string; platformAdmin: boolean }>('select id, "platformAdmin" from "user" where email = $1', [email])
      if (!found.rows[0]) {
        console.log(`${email} is not a member.`)
      } else {
        const { id, platformAdmin } = found.rows[0]
        await client.query('delete from member where "organizationId" = $1 and "userId" = $2', [church.id, id])
        // sessions open in that church would keep pointing at it
        await client.query('delete from session where "userId" = $1 and "activeOrganizationId" = $2', [id, church.id])
        const left = await client.query('select 1 from member where "userId" = $1', [id])
        if (left.rowCount === 0 && !platformAdmin) {
          await client.query('delete from session where "userId" = $1', [id])
          await client.query('delete from account where "userId" = $1', [id])
          await client.query('delete from "user" where id = $1', [id])
          console.log(`Removed ${email} from ${church.slug}; they are in no church now, so they were removed.`)
        } else {
          console.log(`Removed ${email} from ${church.slug}.`)
        }
      }
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    } finally {
      client.release()
    }
  } else if (command === 'platform-admin') {
    const email = normalizeEmail(args[0])
    const grant = flags.revoke !== true
    const { rowCount } = await pool.query('update "user" set "platformAdmin" = $1, "updatedAt" = now() where email = $2', [grant, email])
    console.log(rowCount ? `${email} is ${grant ? 'now' : 'no longer'} the platform admin.` : `${email} is not a member. Add them to a church first.`)
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
} finally {
  await pool.end()
}
