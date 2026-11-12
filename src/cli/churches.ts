/**
 * Manage churches (tenants). A church is a Better Auth organization; only this script makes them.
 *
 *   pnpm churches list
 *   pnpm churches add <slug> <name> [--owner <email>]
 *   pnpm churches rename <slug> <name>
 *   pnpm churches delete <slug>                       shows what deleting it would remove (nothing is deleted)
 *   pnpm churches delete <slug> --confirm <slug>      deletes its R2 files (only with --target prod), then its songs,
 *                                                     arrangements and member links; safe to run again if it stops
 *
 * Add --target prod to act on the production database (default is the Neon dev database).
 */
import { asc, eq, sql } from 'drizzle-orm'
import { openDb } from '../db/client.ts'
import { members, organizations, songs, users } from '../db/schema/index.ts'
import { newId } from '../shared/ids.ts'
import { normalizeEmail, parseArgs, parseSlug } from './lib/cli.ts'
import { deleteChurch, describePlan, planChurchDelete } from './lib/church-delete.ts'
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
  fail('Usage:\n  pnpm churches list\n  pnpm churches add <slug> <name> [--owner <email>]\n  pnpm churches rename <slug> <name>\n  pnpm churches delete <slug> [--confirm <slug>]\n(add --target prod for production)')
}
const { db, close } = openDb(loadTarget(target))
try {
  if (command === 'list') {
    const rows = await db
      .select({
        slug: organizations.slug,
        name: organizations.name,
        id: organizations.id,
        // Drizzle renders single-table columns unqualified, so "id" would bind to the subquery's table: qualify by hand
        members: sql<number>`(select count(*) from ${members} m where m.organization_id = "organizations"."id")::int`,
        songs: sql<number>`(select count(*) from ${songs} s where s.organization_id = "organizations"."id")::int`,
      })
      .from(organizations)
      .orderBy(asc(organizations.createdAt))
    if (rows.length === 0) console.log('No churches yet.')
    for (const r of rows) console.log(`${r.slug}\t${r.name}\t${r.members} members\t${r.songs} songs\t${r.id}`)
  } else if (command === 'add') {
    const slug = parseSlug(args[0])
    const name = args.slice(1).join(' ').trim() || fail('Give the church a name: pnpm churches add <slug> <name>')
    if (await churchBySlug(db, slug)) fail(`There is a church "${slug}" already.`)
    const id = newId()
    const owner = typeof flags.owner === 'string' ? normalizeEmail(flags.owner) : null
    await db.transaction(async (tx) => {
      await tx.insert(organizations).values({ id, name, slug })
      if (!owner) return
      // emailVerified is true because only invited people exist here
      const [user] = await tx
        .insert(users)
        .values({ id: crypto.randomUUID(), name: owner.split('@')[0], email: owner, emailVerified: true })
        .onConflictDoUpdate({ target: users.email, set: { updatedAt: sql`now()` } })
        .returning({ id: users.id })
      await tx.insert(members).values({ id: crypto.randomUUID(), organizationId: id, userId: user.id, role: 'owner' })
    })
    console.log(`Added church ${slug} (${name}), id ${id}.${owner ? ` ${owner} is the owner.` : ''}`)
  } else if (command === 'rename') {
    const church = (await churchBySlug(db, parseSlug(args[0]))) ?? fail('No such church.')
    const name = args.slice(1).join(' ').trim() || fail('Give the new name.')
    await db.update(organizations).set({ name }).where(eq(organizations.id, church.id))
    console.log(`Renamed ${church.slug} to ${name}.`)
  } else if (command === 'delete') {
    const slug = parseSlug(args[0])
    const church = (await churchBySlug(db, slug)) ?? fail(`No church "${slug}" in the ${target} database (already deleted?).`)
    // Only production deletes files: the development branch is a copy of production with the same
    // church ids, so deleting a dev church must never touch production's files.
    const store = target === 'prod' ? new WranglerStore(BUCKET) : null
    try {
      const plan = await planChurchDelete(db, store, church)
      for (const line of describePlan(plan)) console.log(line)
      if (flags.confirm !== slug) {
        console.log(`\nNothing was deleted. To delete all of this from the ${target} database${store ? ' and R2' : ''}:`)
        console.log(`  pnpm churches delete ${slug} --confirm ${slug}${target === 'prod' ? ' --target prod' : ''}`)
      } else {
        console.log(`\nDeleting church ${church.id}. If this stops halfway, run the same command again.`)
        const { filesDeleted } = await deleteChurch(db, store, church, (line) => console.log(line))
        console.log(`Deleted church ${slug}: ${filesDeleted} file(s) from R2${store ? '' : ' (not touched)'}, then its rows from the ${target} database.`)
      }
    } finally {
      store?.close()
    }
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
} finally {
  await close()
}
