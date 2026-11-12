/**
 * Song rows for scripts and the dev server: find a church, find or create a song of that church.
 * Same rules as the Worker (worker/data.ts is reused), so ids are minted in one way only.
 */
import * as data from '../../worker/data.ts'
import type { Db } from '../../worker/data.ts'

export interface Church {
  id: string
  slug: string
  name: string
}

export async function churchBySlug(db: Db, slug: string): Promise<Church | null> {
  const { rows } = await db.query<Church>('select id, slug, name from organization where slug = $1', [slug])
  return rows[0] ?? null
}

export interface SongFields {
  stems?: boolean
  key?: string | null
  bpm?: number | null
  meter?: number | null
}

/**
 * The song of `orgId` called `title`, created when it does not exist. Fields that are given are written
 * to an existing row too (publishing refreshes key, tempo and whether stems exist).
 */
export async function ensureSong(db: Db, orgId: string, title: string, fields: SongFields = {}, createdBy: string | null = null): Promise<{ id: string; created: boolean }> {
  const existing = await db.query<{ id: string }>('select id from song where "organizationId" = $1 and title = $2', [orgId, title])
  if (existing.rows[0]) {
    const sets: string[] = []
    const params: unknown[] = [orgId, existing.rows[0].id]
    const cols = { stems: '"hasStems"', key: '"musicKey"', bpm: 'bpm', meter: 'meter' } as const
    for (const [f, col] of Object.entries(cols) as [keyof typeof cols, string][]) {
      if (fields[f] !== undefined) {
        params.push(fields[f])
        sets.push(`${col} = $${params.length}`)
      }
    }
    if (sets.length > 0) await db.query(`update song set ${sets.join(', ')}, "updatedAt" = now() where "organizationId" = $1 and id = $2`, params)
    return { id: existing.rows[0].id, created: false }
  }
  const made = await data.createSong(db, orgId, createdBy as string, title, { stems: fields.stems ?? false, key: fields.key ?? null, bpm: fields.bpm ?? null, meter: fields.meter ?? null })
  if (made === 'exists') return ensureSong(db, orgId, title, fields, createdBy) // lost a race: it exists now
  return { id: made.id, created: true }
}

/** The user id for an email (the person running a script), or null. */
export async function userIdByEmail(db: Db, email: string | undefined): Promise<string | null> {
  if (!email) return null
  const { rows } = await db.query<{ id: string }>('select id from "user" where email = $1', [email.trim().toLowerCase()])
  return rows[0]?.id ?? null
}
