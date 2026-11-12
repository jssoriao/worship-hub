/**
 * Deleting a church: what `pnpm churches delete` does, kept apart so tests can run it against an
 * in-memory database and file store.
 *
 * Order matters. The church's files in R2 go first, then its database rows in one transaction. If a
 * run stops halfway (network, a failed delete), the church is still in the database, so running the
 * same command again finds it and carries on: files already gone are simply not listed any more.
 * Deleting rows first, as before, could leave files under churches/<id>/ that nothing points to.
 */
import { and, eq, ne, notExists, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import type { Db } from '../../db/client.ts'
import { arrangements, members, organizations, sessions, songs } from '../../db/schema/index.ts'
import type { ObjectStore } from './r2.ts'

export interface ChurchRef {
  id: string
  slug: string
  name: string
}

export interface DeletePlan {
  church: ChurchRef
  members: number
  /** people who belong to no other church, so they would be left with no church */
  peopleLeftWithoutChurch: number
  songs: number
  arrangements: number
  /** sessions whose active church is this one */
  sessions: number
  /** null when files are not part of this run (the dev database) */
  files: { count: number; bytes: number } | null
}

/** The R2 prefix that holds every file of a church. */
export const churchPrefix = (id: string) => `churches/${id}/`

const n = sql<number>`count(*)::int`

/** What deleting the church would remove. Reads only. */
export async function planChurchDelete(db: Db, store: ObjectStore | null, church: ChurchRef): Promise<DeletePlan> {
  const files = store ? await store.list(churchPrefix(church.id)) : null
  const other = alias(members, 'other')
  const [[memberCount], [left], [songCount], [arrangementCount], [sessionCount]] = await Promise.all([
    db.select({ n }).from(members).where(eq(members.organizationId, church.id)),
    db
      .select({ n })
      .from(members)
      .where(
        and(
          eq(members.organizationId, church.id),
          notExists(db.select({ id: other.id }).from(other).where(and(eq(other.userId, members.userId), ne(other.organizationId, church.id)))),
        ),
      ),
    db.select({ n }).from(songs).where(eq(songs.organizationId, church.id)),
    db.select({ n }).from(arrangements).innerJoin(songs, eq(songs.id, arrangements.songId)).where(eq(songs.organizationId, church.id)),
    db.select({ n }).from(sessions).where(eq(sessions.activeOrganizationId, church.id)),
  ])
  return {
    church,
    members: memberCount.n,
    peopleLeftWithoutChurch: left.n,
    songs: songCount.n,
    arrangements: arrangementCount.n,
    sessions: sessionCount.n,
    files: files ? { count: files.length, bytes: files.reduce((total, f) => total + f.size, 0) } : null,
  }
}

const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`

/** Human-readable lines for a plan. */
export function describePlan(p: DeletePlan): string[] {
  return [
    `Church ${p.church.slug} (${p.church.name}), id ${p.church.id}`,
    `  members:      ${p.members}${p.peopleLeftWithoutChurch ? ` (${p.peopleLeftWithoutChurch} would be in no church; their accounts stay, remove them with pnpm members remove)` : ''}`,
    `  songs:        ${p.songs}`,
    `  arrangements: ${p.arrangements}`,
    `  sessions:     ${p.sessions} (they lose their active church and pick another at the next sign-in)`,
    p.files ? `  R2 files:     ${p.files.count} (${mb(p.files.bytes)}) under ${churchPrefix(p.church.id)}` : '  R2 files:     not touched (only --target prod deletes files)',
  ]
}

export interface DeleteResult {
  filesDeleted: number
}

/**
 * Deletes the church: its R2 files first (when a store is given), checked to be gone, then its rows
 * in one transaction (songs, arrangements and member links cascade from the organization).
 */
export async function deleteChurch(db: Db, store: ObjectStore | null, church: ChurchRef, log: (line: string) => void = () => {}): Promise<DeleteResult> {
  let filesDeleted = 0
  if (store) {
    const prefix = churchPrefix(church.id)
    const files = await store.list(prefix)
    for (const [i, f] of files.entries()) {
      await store.delete(f.key)
      filesDeleted++
      if ((i + 1) % 25 === 0 || i + 1 === files.length) log(`  deleted ${i + 1}/${files.length} file(s)`)
    }
    const left = await store.list(prefix)
    if (left.length > 0) throw new Error(`${left.length} file(s) are still under ${prefix}; nothing was deleted from the database. Run the same command again.`)
  }
  await db.transaction(async (tx) => {
    // sessions pointing at it would otherwise keep an active church that no longer exists
    await tx.update(sessions).set({ activeOrganizationId: null }).where(eq(sessions.activeOrganizationId, church.id))
    await tx.delete(organizations).where(eq(organizations.id, church.id))
  })
  return { filesDeleted }
}
