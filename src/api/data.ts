/**
 * The only module with queries for church data (songs, arrangements, membership).
 *
 * Tenancy rule: every function takes the church (`orgId`) first and every query is restricted to it.
 * Arrangements have no church column; they are scoped through their song, so the two can never disagree.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { accounts, arrangements, members, sessions, songs, users } from '../db/schema/index.ts'
import { isUniqueViolation, type Db } from '../db/client.ts'
import { newId } from '../shared/ids.ts'
import { isRole, type Role } from '../shared/permissions.ts'

export type { Db }

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

const iso = (d: Date) => d.toISOString()

// ---------------------------------------------------------------- membership

/** The person's role in that church, or null when they are not a member. Never trusts a cookie. */
export function memberRole(db: Db, userId: string, orgId: string, cache: Memo = memo): Promise<Role | null> {
  return cache.get(`m:${orgId}:${userId}`, async () => {
    const [row] = await db
      .select({ role: members.role })
      .from(members)
      .where(and(eq(members.organizationId, orgId), eq(members.userId, userId)))
      .limit(1)
    return isRole(row?.role) ? row.role : null
  })
}

export interface MemberRow {
  id: string
  userId: string
  name: string
  email: string
  /** always one of the roles: the API only ever writes those */
  role: Role
  joined: string
}

const memberColumns = { id: members.id, userId: members.userId, name: users.name, email: users.email, role: members.role, joined: members.createdAt }

const toMember = (r: { id: string; userId: string; name: string; email: string; role: string; joined: Date }): MemberRow => ({ ...r, role: r.role as Role, joined: iso(r.joined) })

export async function listMembers(db: Db, orgId: string): Promise<MemberRow[]> {
  const rows = await db
    .select(memberColumns)
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(eq(members.organizationId, orgId))
    .orderBy(asc(members.createdAt), asc(users.email))
  return rows.map(toMember)
}

export async function getMember(db: Db, orgId: string, memberId: string): Promise<MemberRow | null> {
  const [row] = await db
    .select(memberColumns)
    .from(members)
    .innerJoin(users, eq(users.id, members.userId))
    .where(and(eq(members.organizationId, orgId), eq(members.id, memberId)))
  return row ? toMember(row) : null
}

/**
 * Adds a person to the church (creating their sign-in record when the email is new). Same effect as
 * `pnpm members add`. 'exists' when they are already in this church. All or nothing.
 */
export async function addMember(db: Db, orgId: string, email: string, name: string, role: Role): Promise<MemberRow | 'exists'> {
  const id = await db.transaction(async (tx) => {
    // Better Auth looks people up by email; emailVerified is true because only invited people exist here
    const [user] = await tx
      .insert(users)
      .values({ id: crypto.randomUUID(), name, email, emailVerified: true })
      .onConflictDoUpdate({ target: users.email, set: { updatedAt: sql`now()` } })
      .returning({ id: users.id })
    const [member] = await tx
      .insert(members)
      .values({ id: crypto.randomUUID(), organizationId: orgId, userId: user.id, role })
      .onConflictDoNothing({ target: [members.organizationId, members.userId] })
      .returning({ id: members.id })
    return member?.id ?? null
  })
  if (!id) return 'exists'
  return (await getMember(db, orgId, id))!
}

/** null when the church has no such member. */
export async function setMemberRole(db: Db, orgId: string, memberId: string, role: Role, cache: Memo = memo): Promise<MemberRow | null> {
  const updated = await db
    .update(members)
    .set({ role })
    .where(and(eq(members.organizationId, orgId), eq(members.id, memberId)))
    .returning({ id: members.id })
  cache.clear()
  return updated[0] ? getMember(db, orgId, memberId) : null
}

/**
 * Takes the person out of the church and ends their sessions there. Someone left in no church (and not
 * the platform admin) is removed entirely, as `pnpm members remove` does. False when there is no such member.
 */
export async function removeMember(db: Db, orgId: string, memberId: string, cache: Memo = memo): Promise<boolean> {
  const removed = await db.transaction(async (tx) => {
    const [gone] = await tx
      .delete(members)
      .where(and(eq(members.organizationId, orgId), eq(members.id, memberId)))
      .returning({ userId: members.userId })
    if (!gone) return false
    await removePersonIfChurchless(tx, gone.userId, orgId)
    return true
  })
  cache.clear()
  return removed
}

/**
 * After someone left `orgId`: ends their sessions there, and when they are in no church any more (and
 * are not the platform admin) removes their sessions, accounts and sign-in record. Shared with the CLI.
 * Returns true when the person was removed entirely.
 */
export async function removePersonIfChurchless(db: Pick<Db, 'select' | 'delete'>, userId: string, orgId: string): Promise<boolean> {
  // sessions open in that church would keep pointing at it
  await db.delete(sessions).where(and(eq(sessions.userId, userId), eq(sessions.activeOrganizationId, orgId)))
  const left = await db.select({ id: members.id }).from(members).where(eq(members.userId, userId)).limit(1)
  if (left.length > 0) return false
  const [person] = await db.select({ platformAdmin: users.platformAdmin }).from(users).where(eq(users.id, userId))
  if (!person || person.platformAdmin) return false
  await db.delete(sessions).where(eq(sessions.userId, userId))
  await db.delete(accounts).where(eq(accounts.userId, userId))
  await db.delete(users).where(eq(users.id, userId))
  return true
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

const songColumns = { id: songs.id, title: songs.title, artist: songs.artist, key: songs.musicKey, bpm: songs.bpm, meter: songs.meter, stems: songs.hasStems }

export async function listSongs(db: Db, orgId: string): Promise<SongRow[]> {
  return db
    .select(songColumns)
    .from(songs)
    .where(eq(songs.organizationId, orgId))
    .orderBy(sql`lower(${songs.title})`, asc(songs.id))
}

export function songBelongs(db: Db, orgId: string, songId: string, cache: Memo = memo): Promise<true | null> {
  return cache.get(`s:${orgId}:${songId}`, async () => {
    const rows = await db
      .select({ id: songs.id })
      .from(songs)
      .where(and(eq(songs.organizationId, orgId), eq(songs.id, songId)))
      .limit(1)
    return rows.length > 0 ? true : null
  })
}

export async function getSong(db: Db, orgId: string, songId: string): Promise<SongRow | null> {
  const [row] = await db
    .select(songColumns)
    .from(songs)
    .where(and(eq(songs.organizationId, orgId), eq(songs.id, songId)))
  return row ?? null
}

/** 'exists' when the church already has a song with that title. */
export async function createSong(db: Db, orgId: string, userId: string | null, title: string, extra: Partial<Omit<SongRow, 'id' | 'title'>> = {}): Promise<SongRow | 'exists'> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [row] = await db
        .insert(songs)
        .values({
          id: newId(),
          organizationId: orgId,
          title,
          artist: extra.artist ?? null,
          musicKey: extra.key ?? null,
          bpm: extra.bpm ?? null,
          meter: extra.meter ?? null,
          hasStems: extra.stems ?? false,
          createdBy: userId,
        })
        .returning(songColumns)
      return row
    } catch (error) {
      if (isUniqueViolation(error, 'songs_pkey')) continue // id clash: draw another
      if (isUniqueViolation(error)) return 'exists'
      throw error
    }
  }
  throw new Error('could not find a free song id')
}

export type SongPatch = Partial<Pick<SongRow, 'title' | 'artist' | 'key' | 'bpm' | 'meter' | 'stems'>>

const patchColumns = { title: 'title', artist: 'artist', key: 'musicKey', bpm: 'bpm', meter: 'meter', stems: 'hasStems' } as const

/** null = no such song in this church, 'exists' = the title is taken. */
export async function updateSong(db: Db, orgId: string, songId: string, patch: SongPatch): Promise<SongRow | null | 'exists'> {
  const set: Partial<typeof songs.$inferInsert> = {}
  for (const [field, column] of Object.entries(patchColumns) as [keyof SongPatch, (typeof patchColumns)[keyof SongPatch]][]) {
    if (field in patch) (set as Record<string, unknown>)[column] = patch[field] ?? (field === 'stems' ? false : null)
  }
  if (Object.keys(set).length === 0) return getSong(db, orgId, songId)
  try {
    const [row] = await db
      .update(songs)
      .set({ ...set, updatedAt: sql`now()` })
      .where(and(eq(songs.organizationId, orgId), eq(songs.id, songId)))
      .returning(songColumns)
    return row ?? null
  } catch (error) {
    if (isUniqueViolation(error)) return 'exists'
    throw error
  }
}

/** Deletes the song row (and, by cascade, its arrangements). False when the church has no such song. */
export async function deleteSong(db: Db, orgId: string, songId: string, cache: Memo = memo): Promise<boolean> {
  const rows = await db
    .delete(songs)
    .where(and(eq(songs.organizationId, orgId), eq(songs.id, songId)))
    .returning({ id: songs.id })
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

/** Song ids of this church with this id: a subquery that keeps arrangement queries inside the church. */
const songOfChurch = (db: Db, orgId: string, songId: string) =>
  db
    .select({ id: songs.id })
    .from(songs)
    .where(and(eq(songs.organizationId, orgId), eq(songs.id, songId)))

export async function listArrangements(db: Db, orgId: string, songId: string): Promise<ArrangementInfo[]> {
  const rows = await db
    .select({ id: arrangements.id, name: arrangements.name, owner: arrangements.ownerId, ownerName: users.name, updated: arrangements.updatedAt })
    .from(arrangements)
    .leftJoin(users, eq(users.id, arrangements.ownerId))
    .where(inArray(arrangements.songId, songOfChurch(db, orgId, songId)))
    .orderBy(desc(arrangements.updatedAt), asc(arrangements.id))
  return rows.map((r) => ({ id: r.id, name: r.name, owner: r.owner ?? '', ownerName: r.ownerName ?? '', updated: iso(r.updated) }))
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
  const [row] = await db
    .select({ id: arrangements.id, songId: arrangements.songId, owner: arrangements.ownerId, name: arrangements.name, data: arrangements.data, updated: arrangements.updatedAt })
    .from(arrangements)
    .where(and(eq(arrangements.id, id), inArray(arrangements.songId, songOfChurch(db, orgId, songId))))
  return row ? { ...row, updated: iso(row.updated) } : null
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
  if (!(await getSong(db, orgId, songId))) return null
  const saved = await db
    .insert(arrangements)
    .values({ id, songId, ownerId, name, data })
    .onConflictDoUpdate({
      target: arrangements.id,
      set: { name: sql`excluded.name`, data: sql`excluded.data`, updatedAt: sql`now()` },
      // an id that belongs to another song is not taken over
      setWhere: sql`${arrangements.songId} = excluded.song_id`,
    })
    .returning({ id: arrangements.id })
  return saved[0] ? getArrangement(db, orgId, songId, id) : null
}

export async function deleteArrangement(db: Db, orgId: string, songId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(arrangements)
    .where(and(eq(arrangements.id, id), inArray(arrangements.songId, songOfChurch(db, orgId, songId))))
    .returning({ id: arrangements.id })
  return rows.length > 0
}

