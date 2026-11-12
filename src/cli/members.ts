/**
 * Manage who may sign in, and in which church. People are `users` rows; their church and role is a `members` row.
 * Nobody signs up themselves. Roles: member, editor, admin, owner (see src/shared/permissions.ts).
 *
 *   pnpm members list [--church <slug>]
 *   pnpm members add <email> [name] --church <slug> --role <role>    adds the person (and the church link), or changes their role
 *   pnpm members remove <email> --church <slug>                      leaves that church; a person with no church left is removed
 *   pnpm members platform-admin <email> [--revoke]                   the platform super admin: runs Music.AI, outside any church
 *
 * Add --target prod to act on the production database (default is the Neon dev database).
 * A removed person's open session works for up to 30 seconds on songs and 5 minutes elsewhere (cookie cache).
 */
import { and, asc, eq, sql } from 'drizzle-orm'
import { removePersonIfChurchless } from '../api/data.ts'
import { openDb } from '../db/client.ts'
import { members, organizations, users } from '../db/schema/index.ts'
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
const { db, close } = openDb(loadTarget(target))

async function churchOf(): Promise<{ id: string; slug: string; name: string }> {
  const slug = typeof flags.church === 'string' ? flags.church : ''
  if (!slug) return fail('Say which church: --church <slug> (pnpm churches list)')
  return (await churchBySlug(db, parseSlug(slug))) ?? fail(`No church "${slug}". pnpm churches list`)
}

try {
  if (command === 'list') {
    const church = typeof flags.church === 'string' ? await churchOf() : null
    const rows = await db
      .select({ email: users.email, name: users.name, platform: users.platformAdmin, slug: organizations.slug, role: members.role })
      .from(users)
      .leftJoin(members, eq(members.userId, users.id))
      .leftJoin(organizations, eq(organizations.id, members.organizationId))
      .where(church ? eq(organizations.id, church.id) : undefined)
      .orderBy(asc(users.createdAt), asc(organizations.slug))
    if (rows.length === 0) console.log('No members yet.')
    for (const r of rows) console.log(`${r.email}\t${r.slug ?? '(no church)'}\t${r.role ?? '-'}\t${r.platform ? 'platform admin' : ''}\t${r.name}`)
  } else if (command === 'add') {
    const email = normalizeEmail(args[0])
    const name = args[1] ?? email.split('@')[0]
    const role = parseRole(flags.role)
    const church = await churchOf()
    const updated = await db.transaction(async (tx) => {
      // Better Auth looks people up by email; emailVerified is true because only invited people exist here
      const [user] = await tx
        .insert(users)
        .values({ name, email, emailVerified: true })
        .onConflictDoUpdate({ target: users.email, set: { updatedAt: sql`now()` } })
        .returning({ id: users.id })
      const changed = await tx
        .update(members)
        .set({ role })
        .where(and(eq(members.organizationId, church.id), eq(members.userId, user.id)))
        .returning({ id: members.id })
      if (changed.length === 0) await tx.insert(members).values({ organizationId: church.id, userId: user.id, role })
      return changed.length > 0
    })
    console.log(`${updated ? 'Updated' : 'Added'} ${email} in ${church.slug} as ${role}.`)
  } else if (command === 'remove') {
    const email = normalizeEmail(args[0])
    const church = await churchOf()
    const outcome = await db.transaction(async (tx) => {
      const [person] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email))
      if (!person) return 'unknown'
      await tx.delete(members).where(and(eq(members.organizationId, church.id), eq(members.userId, person.id)))
      return (await removePersonIfChurchless(tx, person.id, church.id)) ? 'gone' : 'left'
    })
    if (outcome === 'unknown') console.log(`${email} is not a member.`)
    else if (outcome === 'gone') console.log(`Removed ${email} from ${church.slug}; they are in no church now, so they were removed.`)
    else console.log(`Removed ${email} from ${church.slug}.`)
  } else if (command === 'platform-admin') {
    const email = normalizeEmail(args[0])
    const grant = flags.revoke !== true
    const changed = await db.update(users).set({ platformAdmin: grant, updatedAt: sql`now()` }).where(eq(users.email, email)).returning({ id: users.id })
    console.log(changed.length ? `${email} is ${grant ? 'now' : 'no longer'} the platform admin.` : `${email} is not a member. Add them to a church first.`)
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
} finally {
  await close()
}
