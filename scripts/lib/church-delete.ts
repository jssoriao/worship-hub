/**
 * Deleting a church: what `pnpm churches delete` does, kept apart so tests can run it against an
 * in-memory database and file store.
 *
 * Order matters. The church's files in R2 go first, then its database rows in one transaction. If a
 * run stops halfway (network, a failed delete), the church is still in the database, so running the
 * same command again finds it and carries on: files already gone are simply not listed any more.
 * Deleting rows first, as before, could leave files under churches/<id>/ that nothing points to.
 */
import type { Db } from '../../worker/data.ts'
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

const count = async (db: Db, sql: string, id: string) => Number((await db.query<{ n: number }>(sql, [id])).rows[0]?.n ?? 0)

/** What deleting the church would remove. Reads only. */
export async function planChurchDelete(db: Db, store: ObjectStore | null, church: ChurchRef): Promise<DeletePlan> {
  const files = store ? await store.list(churchPrefix(church.id)) : null
  return {
    church,
    members: await count(db, 'select count(*)::int as n from member where "organizationId" = $1', church.id),
    peopleLeftWithoutChurch: await count(
      db,
      `select count(*)::int as n from member m
        where m."organizationId" = $1
          and not exists (select 1 from member o where o."userId" = m."userId" and o."organizationId" <> $1)`,
      church.id,
    ),
    songs: await count(db, 'select count(*)::int as n from song where "organizationId" = $1', church.id),
    arrangements: await count(db, 'select count(*)::int as n from arrangement a join song s on s.id = a."songId" where s."organizationId" = $1', church.id),
    sessions: await count(db, 'select count(*)::int as n from session where "activeOrganizationId" = $1', church.id),
    files: files ? { count: files.length, bytes: files.reduce((n, f) => n + f.size, 0) } : null,
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
 * `db` must be a single connection, so the transaction holds.
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
  await db.query('begin')
  try {
    // sessions pointing at it would otherwise keep an active church that no longer exists
    await db.query('update session set "activeOrganizationId" = null where "activeOrganizationId" = $1', [church.id])
    await db.query('delete from organization where id = $1', [church.id])
    await db.query('commit')
  } catch (error) {
    await db.query('rollback')
    throw error
  }
  return { filesDeleted }
}
