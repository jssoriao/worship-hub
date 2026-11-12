/**
 * The only module with SQL for church data (songs, arrangements, membership).
 *
 * Tenancy rule: every function takes the church (`orgId`) first and every query is restricted to it.
 * Arrangements have no church column; they are scoped through their song, so the two can never disagree.
 */
import { newId } from '../shared/ids.ts'
import { isRole, type Role } from '../shared/permissions.ts'

/** What a pg-style pool or client offers; tests plug in PGlite. */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>
}

// ---------------------------------------------------------------- short-lived memory

/** Remembers positive answers for a short time, so range requests don't hit the database each time. */
export class Memo {
  private entries = new Map<string, { until: number; value: unknown }>()
  private ttlMs: number
  private now: () => number
  constructor(ttlMs = 30_000, now: () => number = Date.now) {
    this.ttlMs = ttlMs
    this.now = now
  }
  async get<T>(key: string, load: () => Promise<T | null>): Promise<T | null> {
    const hit = this.entries.get(key)
    if (hit && hit.until > this.now()) return hit.value as T
    const value = await load()
    // only positive results are kept: a removed member must be denied right after the TTL, and a
    // new member allowed right away
    if (value !== null) {
      if (this.entries.size > 2000) this.entries.clear()
      this.entries.set(key, { until: this.now() + this.ttlMs, value })
    }
    return value
  }
  clear() {
    this.entries.clear()
  }
}
export const memo = new Memo()

// ---------------------------------------------------------------- membership

/** The person's role in that church, or null when they are not a member. Never trusts a cookie. */
export function memberRole(db: Db, userId: string, orgId: string, cache: Memo = memo): Promise<Role | null> {
  return cache.get(`m:${orgId}:${userId}`, async () => {
    const { rows } = await db.query<{ role: string }>('select role from member where "organizationId" = $1 and "userId" = $2 limit 1', [orgId, userId])
    const role = rows[0]?.role
    return isRole(role) ? role : null
  })
}

// ---------------------------------------------------------------- songs

export interface SongRow {
  id: string
  title: string
  artist: string | null
  key: string | null
  bpm: number | null
  meter: number | null
  stems: boolean
}

const SONG_COLUMNS = `id, title, artist, "musicKey" as key, bpm::float8 as bpm, meter, "hasStems" as stems`

export async function listSongs(db: Db, orgId: string): Promise<SongRow[]> {
  const { rows } = await db.query<SongRow>(`select ${SONG_COLUMNS} from song where "organizationId" = $1 order by lower(title), id`, [orgId])
  return rows
}

export function songBelongs(db: Db, orgId: string, songId: string, cache: Memo = memo): Promise<true | null> {
  return cache.get(`s:${orgId}:${songId}`, async () => {
    const { rows } = await db.query('select 1 from song where "organizationId" = $1 and id = $2', [orgId, songId])
    return rows.length > 0 ? true : null
  })
}

export async function getSong(db: Db, orgId: string, songId: string): Promise<SongRow | null> {
  const { rows } = await db.query<SongRow>(`select ${SONG_COLUMNS} from song where "organizationId" = $1 and id = $2`, [orgId, songId])
  return rows[0] ?? null
}

const isUnique = (error: unknown, constraint?: string) => {
  const e = error as { code?: string; constraint?: string }
  return e?.code === '23505' && (!constraint || e.constraint === constraint)
}

/** 'exists' when the church already has a song with that title. */
export async function createSong(db: Db, orgId: string, userId: string, title: string, extra: Partial<Omit<SongRow, 'id' | 'title'>> = {}): Promise<SongRow | 'exists'> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = newId()
    try {
      const { rows } = await db.query<SongRow>(
        `insert into song (id, "organizationId", title, artist, "musicKey", bpm, meter, "hasStems", "createdBy")
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning ${SONG_COLUMNS}`,
        [id, orgId, title, extra.artist ?? null, extra.key ?? null, extra.bpm ?? null, extra.meter ?? null, extra.stems ?? false, userId],
      )
      return rows[0]
    } catch (error) {
      if (isUnique(error, 'song_pkey')) continue // id clash: draw another
      if (isUnique(error)) return 'exists'
      throw error
    }
  }
  throw new Error('could not find a free song id')
}

export type SongPatch = Partial<Pick<SongRow, 'title' | 'artist' | 'key' | 'bpm' | 'meter'>>

/** null = no such song in this church, 'exists' = the title is taken. */
export async function updateSong(db: Db, orgId: string, songId: string, patch: SongPatch): Promise<SongRow | null | 'exists'> {
  const sets: string[] = []
  const params: unknown[] = [orgId, songId]
  const columns = { title: 'title', artist: 'artist', key: '"musicKey"', bpm: 'bpm', meter: 'meter' } as const
  for (const [field, column] of Object.entries(columns) as [keyof typeof columns, string][]) {
    if (field in patch) {
      params.push(patch[field] ?? null)
      sets.push(`${column} = $${params.length}`)
    }
  }
  if (sets.length === 0) return getSong(db, orgId, songId)
  try {
    const { rows } = await db.query<SongRow>(
      `update song set ${sets.join(', ')}, "updatedAt" = now() where "organizationId" = $1 and id = $2 returning ${SONG_COLUMNS}`,
      params,
    )
    return rows[0] ?? null
  } catch (error) {
    if (isUnique(error)) return 'exists'
    throw error
  }
}

/** Deletes the song row (and, by cascade, its arrangements). False when the church has no such song. */
export async function deleteSong(db: Db, orgId: string, songId: string, cache: Memo = memo): Promise<boolean> {
  const { rows } = await db.query('delete from song where "organizationId" = $1 and id = $2 returning id', [orgId, songId])
  cache.clear()
  return rows.length > 0
}

// ---------------------------------------------------------------- arrangements

export interface ArrangementInfo {
  id: string
  name: string
  owner: string
  ownerName: string
  updated: string
}

export async function listArrangements(db: Db, orgId: string, songId: string): Promise<ArrangementInfo[]> {
  const { rows } = await db.query<ArrangementInfo>(
    `select a.id, a.name, coalesce(a.owner, '') as owner, coalesce(u.name, '') as "ownerName", to_char(a."updatedAt" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated
       from arrangement a
       join song s on s.id = a."songId"
       left join "user" u on u.id = a.owner
      where s."organizationId" = $1 and s.id = $2
      order by a."updatedAt" desc, a.id`,
    [orgId, songId],
  )
  return rows
}

export interface ArrangementRow {
  id: string
  songId: string
  owner: string | null
  name: string
  data: Record<string, unknown>
  updated: string
}

export async function getArrangement(db: Db, orgId: string, songId: string, id: string): Promise<ArrangementRow | null> {
  const { rows } = await db.query<ArrangementRow>(
    `select a.id, a."songId", a.owner, a.name, a.data, to_char(a."updatedAt" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated
       from arrangement a join song s on s.id = a."songId"
      where s."organizationId" = $1 and s.id = $2 and a.id = $3`,
    [orgId, songId, id],
  )
  return rows[0] ?? null
}

/**
 * Creates or replaces an arrangement of a song of this church. The owner is kept from the stored copy.
 * Returns null when the song is not in this church, or the id belongs to another song.
 */
export async function saveArrangement(
  db: Db,
  orgId: string,
  songId: string,
  id: string,
  ownerId: string,
  name: string,
  data: Record<string, unknown>,
): Promise<ArrangementRow | null> {
  const { rows } = await db.query<{ id: string }>(
    `insert into arrangement (id, "songId", owner, name, data)
     select $3, s.id, $4, $5, $6::jsonb from song s where s."organizationId" = $1 and s.id = $2
     on conflict (id) do update set name = excluded.name, data = excluded.data, "updatedAt" = now()
       where arrangement."songId" = excluded."songId"
     returning id`,
    [orgId, songId, id, ownerId, name, JSON.stringify(data)],
  )
  return rows[0] ? getArrangement(db, orgId, songId, id) : null
}

export async function deleteArrangement(db: Db, orgId: string, songId: string, id: string): Promise<boolean> {
  const { rows } = await db.query(
    `delete from arrangement a using song s
      where s.id = a."songId" and s."organizationId" = $1 and s.id = $2 and a.id = $3 returning a.id`,
    [orgId, songId, id],
  )
  return rows.length > 0
}
