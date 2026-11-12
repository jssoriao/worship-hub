/**
 * Song rows for scripts: find a church, find or create a song of that church.
 * Same rules as the Worker (src/api/data.ts is reused), so ids are minted in one way only.
 */
import { and, eq } from 'drizzle-orm'
import * as data from '../../api/data.ts'
import type { Db } from '../../db/client.ts'
import { organizations, songs, users } from '../../db/schema/index.ts'

export interface Church {
  id: string
  slug: string
  name: string
}

export async function churchBySlug(db: Db, slug: string): Promise<Church | null> {
  const [row] = await db.select({ id: organizations.id, slug: organizations.slug, name: organizations.name }).from(organizations).where(eq(organizations.slug, slug))
  return row ?? null
}

export interface SongFields {
  stems?: boolean
  key?: string | null
  bpm?: number | null
  meter?: number | null
}

/** The id of the song of `orgId` called `title`, or null. */
export async function songIdByTitle(db: Db, orgId: string, title: string): Promise<string | null> {
  const [row] = await db
    .select({ id: songs.id })
    .from(songs)
    .where(and(eq(songs.organizationId, orgId), eq(songs.title, title)))
  return row?.id ?? null
}

/**
 * The song of `orgId` called `title`, created when it does not exist. Fields that are given are written
 * to an existing row too (publishing refreshes key, tempo and whether stems exist).
 */
export async function ensureSong(db: Db, orgId: string, title: string, fields: SongFields = {}, createdBy: string | null = null): Promise<{ id: string; created: boolean }> {
  const id = await songIdByTitle(db, orgId, title)
  if (id) {
    const patch: data.SongPatch = {}
    if (fields.stems !== undefined) patch.stems = fields.stems
    if (fields.key !== undefined) patch.key = fields.key
    if (fields.bpm !== undefined) patch.bpm = fields.bpm
    if (fields.meter !== undefined) patch.meter = fields.meter
    await data.updateSong(db, orgId, id, patch)
    return { id, created: false }
  }
  const made = await data.createSong(db, orgId, createdBy, title, { stems: fields.stems ?? false, key: fields.key ?? null, bpm: fields.bpm ?? null, meter: fields.meter ?? null })
  if (made === 'exists') return ensureSong(db, orgId, title, fields, createdBy) // lost a race: it exists now
  return { id: made.id, created: true }
}

/** The user id for an email (the person running a script), or null. */
export async function userIdByEmail(db: Db, email: string | undefined): Promise<string | null> {
  if (!email) return null
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.email, email.trim().toLowerCase()))
  return row?.id ?? null
}
