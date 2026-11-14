/**
 * Really deleting a song (the app only archives): what `pnpm songs:delete` does, kept apart so tests can
 * run it against an in-memory database and file store. Same order as deleting a church: the files first,
 * checked to be gone, then the database row (its arrangements go with it). If a run stops halfway the
 * song is still in the database, so running the same command again finds it and carries on.
 */
import { and, eq, sql } from 'drizzle-orm'
import type { Db } from '../../db/client.ts'
import { arrangements, songs } from '../../db/schema/index.ts'
import type { ObjectStore } from './r2.ts'

export interface SongRef {
  id: string
  title: string
  archived: boolean
}
/** The R2 prefix that holds every file of a song. */
export const songFolder = (orgId: string, songId: string) => `churches/${orgId}/songs/${songId}/`
const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`

/** The song of this church with this exact title, archived or not; null when there is none. */
export async function findSong(db: Db, orgId: string, title: string): Promise<SongRef | null> {
  const [row] = await db
    .select({ id: songs.id, title: songs.title, archivedAt: songs.archivedAt })
    .from(songs)
    .where(and(eq(songs.organizationId, orgId), eq(songs.title, title)))
  return row ? { id: row.id, title: row.title, archived: row.archivedAt !== null } : null
}

/** What deleting would remove, as lines to print. Reads only. */
export async function describeSongDelete(db: Db, store: ObjectStore | null, orgId: string, song: SongRef): Promise<string[]> {
  const files = store ? await store.list(songFolder(orgId, song.id)) : null
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(arrangements).where(eq(arrangements.songId, song.id))
  return [
    `Song "${song.title}", id ${song.id}${song.archived ? ' (archived)' : ' (NOT archived: people can see it now)'}`,
    `  arrangements: ${n}`,
    files ? `  R2 files:     ${files.length} (${mb(files.reduce((t, f) => t + f.size, 0))}) under ${songFolder(orgId, song.id)}` : '  R2 files:     not touched (only --target prod deletes files)',
  ]
}

/** Deletes the song's files (when a store is given), then its row. Returns how many files went. */
export async function deleteSong(db: Db, store: ObjectStore | null, orgId: string, song: SongRef, log: (line: string) => void = () => {}): Promise<number> {
  let deleted = 0
  if (store) {
    const prefix = songFolder(orgId, song.id)
    const files = await store.list(prefix)
    for (const [i, f] of files.entries()) {
      await store.delete(f.key)
      deleted++
      if ((i + 1) % 25 === 0 || i + 1 === files.length) log(`  deleted ${i + 1}/${files.length} file(s)`)
    }
    const left = await store.list(prefix)
    if (left.length > 0) throw new Error(`${left.length} file(s) are still under ${prefix}; the song was not deleted from the database. Run the same command again.`)
  }
  await db.delete(songs).where(and(eq(songs.organizationId, orgId), eq(songs.id, song.id)))
  return deleted
}
