/**
 * The only module with queries for church data (songs, arrangements, membership, join links).
 *
 * Tenancy rule: every function takes the church (`orgId`) first and every query is restricted to it.
 * Arrangements have no church column; they are scoped through their song, so the two can never disagree.
 */
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm'
import { customAlphabet } from 'nanoid'
import { accounts, arrangements, joinLinks, joinRequests, members, organizations, sessions, songs, users } from '../db/schema/index.ts'
import { ID_ALPHABET } from '../shared/ids.ts'
import { isUniqueViolation, type Db } from '../db/client.ts'
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
      .values({ name, email, emailVerified: true })
      .onConflictDoUpdate({ target: users.email, set: { updatedAt: sql`now()` } })
      .returning({ id: users.id })
    const [member] = await tx
      .insert(members)
      .values({ organizationId: orgId, userId: user.id, role })
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
  try {
    const [row] = await db
      .insert(songs)
      .values({
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
    if (isUniqueViolation(error)) return 'exists'
    throw error
  }
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

// ---------------------------------------------------------------- join links
/** How long a link works: a link for one person 3 days, a shared one 1 day. */
export const JOIN_LINK_HOURS = { single: 72, shared: 24 } as const
/** How long after opening a link someone may get a sign-in code and an account (see auth-options.ts). */
export const JOIN_REQUEST_MINUTES = 30
/** The secret in a link (/join/<token>): 32 of [0-9a-z], about 165 bits. */
export const JOIN_TOKEN = /^[0-9a-z]{32}$/
const newToken = customAlphabet(ID_ALPHABET, 32)
/** What is stored instead of the secret: its SHA-256, hex. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
export interface JoinLinkRow {
  id: string
  role: Role
  singleUse: boolean
  createdBy: string | null
  createdAt: string
  expiresAt: string
  uses: number
}
const linkColumns = {
  id: joinLinks.id,
  role: joinLinks.role,
  singleUse: joinLinks.singleUse,
  createdBy: users.name,
  createdAt: joinLinks.createdAt,
  expiresAt: joinLinks.expiresAt,
  uses: joinLinks.uses,
}
const toLink = (r: { id: string; role: string; singleUse: boolean; createdBy: string | null; createdAt: Date; expiresAt: Date; uses: number }): JoinLinkRow => ({
  ...r,
  role: r.role as Role,
  createdAt: iso(r.createdAt),
  expiresAt: iso(r.expiresAt),
})
/** A link still works: not turned off, not expired, and (for one person) not used. */
const working = () => and(isNull(joinLinks.revokedAt), gt(joinLinks.expiresAt, sql`now()`), or(eq(joinLinks.singleUse, false), isNull(joinLinks.usedAt)))
/** A new link for the church. The secret is returned once, here; only its hash is kept. */
export async function createJoinLink(db: Db, orgId: string, input: { role: Role; singleUse: boolean; createdBy: string }): Promise<{ link: JoinLinkRow; token: string }> {
  const token = newToken()
  const hours = input.singleUse ? JOIN_LINK_HOURS.single : JOIN_LINK_HOURS.shared
  const [row] = await db
    .insert(joinLinks)
    .values({
      organizationId: orgId,
      role: input.role,
      singleUse: input.singleUse,
      tokenHash: await hashToken(token),
      createdBy: input.createdBy,
      expiresAt: sql`now() + make_interval(hours => ${hours})`,
    })
    .returning({ id: joinLinks.id })
  return { link: (await listJoinLinks(db, orgId)).find((l) => l.id === row.id)!, token }
}
/** The church's links that still work, newest first. */
export async function listJoinLinks(db: Db, orgId: string): Promise<JoinLinkRow[]> {
  const rows = await db
    .select(linkColumns)
    .from(joinLinks)
    .leftJoin(users, eq(users.id, joinLinks.createdBy))
    .where(and(eq(joinLinks.organizationId, orgId), working()))
    .orderBy(desc(joinLinks.createdAt))
  return rows.map(toLink)
}
/** The link's role, for checking who may turn it off; null when the church has no such working link. */
export async function joinLinkRole(db: Db, orgId: string, linkId: string): Promise<Role | null> {
  const [row] = await db
    .select({ role: joinLinks.role })
    .from(joinLinks)
    .where(and(eq(joinLinks.organizationId, orgId), eq(joinLinks.id, linkId), working()))
  return isRole(row?.role) ? row.role : null
}
/** How long a link that has ended (expired, used up or turned off) is kept, so Members can still show who joined. */
export const JOIN_LINK_KEEP_DAYS = 7
/**
 * Deletes this church's links that ended more than JOIN_LINK_KEEP_DAYS ago (their join requests go with
 * them), and every join request past its time. Runs when the church's links are listed.
 */
export async function deleteStaleJoinData(db: Db, orgId: string): Promise<void> {
  // a link ended at the earliest of: its expiry, being turned off, being used up (one-person links only set used_at)
  await db.delete(joinLinks).where(
    and(
      eq(joinLinks.organizationId, orgId),
      sql`least(${joinLinks.expiresAt}, coalesce(${joinLinks.revokedAt}, 'infinity'::timestamptz), coalesce(${joinLinks.usedAt}, 'infinity'::timestamptz)) < now() - make_interval(days => ${JOIN_LINK_KEEP_DAYS})`,
    ),
  )
  await db.delete(joinRequests).where(sql`${joinRequests.expiresAt} <= now()`)
}
/** Turns a link off (and drops its pending sign-ins). False when the church has no such working link. */
export async function revokeJoinLink(db: Db, orgId: string, linkId: string): Promise<boolean> {
  const done = await db
    .update(joinLinks)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(joinLinks.organizationId, orgId), eq(joinLinks.id, linkId), working()))
    .returning({ id: joinLinks.id })
  if (done.length > 0) await db.delete(joinRequests).where(eq(joinRequests.linkId, linkId))
  return done.length > 0
}
/** Why a link does not work: unknown, turned off, already used (one person), or past its time. */
export type LinkProblem = 'missing' | 'off' | 'used' | 'expired'
export type FoundLink = { id: string; orgId: string; church: string; role: Role; singleUse: boolean }
type LinkState = { id: string; orgId: string; church: string; role: string; singleUse: boolean; revoked: boolean; used: boolean; expired: boolean }
const problemOf = (r: LinkState | undefined): LinkProblem | null =>
  !r || !isRole(r.role) ? 'missing' : r.revoked ? 'off' : r.singleUse && r.used ? 'used' : r.expired ? 'expired' : null
const linkState = {
  id: joinLinks.id,
  orgId: joinLinks.organizationId,
  church: organizations.name,
  role: joinLinks.role,
  singleUse: joinLinks.singleUse,
  revoked: sql<boolean>`${joinLinks.revokedAt} is not null`,
  used: sql<boolean>`${joinLinks.usedAt} is not null`,
  expired: sql<boolean>`${joinLinks.expiresAt} <= now()`,
}
/**
 * The link a secret belongs to, found by its hash. This is the one lookup without a church: the
 * secret is what says which church, as a session does elsewhere.
 */
export async function findJoinLink(db: Db, token: string): Promise<FoundLink | LinkProblem> {
  if (!JOIN_TOKEN.test(token)) return 'missing'
  const [row] = await db
    .select(linkState)
    .from(joinLinks)
    .innerJoin(organizations, eq(organizations.id, joinLinks.organizationId))
    .where(eq(joinLinks.tokenHash, await hashToken(token)))
  const problem = problemOf(row)
  return problem ?? { id: row.id, orgId: row.orgId, church: row.church, role: row.role as Role, singleUse: row.singleUse }
}
/** Someone opened the link and is about to ask for a code at this address. */
export async function addJoinRequest(db: Db, linkId: string, email: string): Promise<void> {
  await db.delete(joinRequests).where(sql`${joinRequests.expiresAt} <= now()`)
  await db.insert(joinRequests).values({ linkId, email, expiresAt: sql`now() + make_interval(mins => ${JOIN_REQUEST_MINUTES})` })
}
/** Whether this address came through a working link lately: only then may it get a code without an account. */
export async function hasJoinRequest(db: Db, email: string): Promise<boolean> {
  const rows = await db
    .select({ id: joinRequests.id })
    .from(joinRequests)
    .innerJoin(joinLinks, eq(joinLinks.id, joinRequests.linkId))
    .where(and(eq(joinRequests.email, email.trim().toLowerCase()), gt(joinRequests.expiresAt, sql`now()`), working()))
    .limit(1)
  return rows.length > 0
}
/**
 * Adds the signed-in person to the link's church with the link's role, and uses the link up when it is
 * for one person. Someone already in the church keeps their role and leaves the link unused.
 * All or nothing; the link row is locked, so a single-use link can never let in two people.
 */
export async function joinWithLink(db: Db, token: string, user: { id: string; email: string }): Promise<{ orgId: string; already: boolean } | LinkProblem> {
  if (!JOIN_TOKEN.test(token)) return 'missing'
  const tokenHash = await hashToken(token)
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select(linkState)
      .from(joinLinks)
      .innerJoin(organizations, eq(organizations.id, joinLinks.organizationId))
      .where(eq(joinLinks.tokenHash, tokenHash))
      .for('update', { of: joinLinks })
    const problem = problemOf(row)
    if (problem) return problem
    const [added] = await tx
      .insert(members)
      .values({ organizationId: row.orgId, userId: user.id, role: row.role })
      .onConflictDoNothing({ target: [members.organizationId, members.userId] })
      .returning({ id: members.id })
    if (added) {
      await tx
        .update(joinLinks)
        .set({ uses: sql`${joinLinks.uses} + 1`, ...(row.singleUse ? { usedAt: sql`now()`, usedBy: user.id } : {}) })
        .where(eq(joinLinks.id, row.id))
      // an account made by the sign-in has no name yet: start with the address's first part
      await tx
        .update(users)
        .set({ name: user.email.split('@')[0] })
        .where(and(eq(users.id, user.id), eq(users.name, '')))
    }
    await tx.delete(joinRequests).where(eq(joinRequests.email, user.email.trim().toLowerCase()))
    return { orgId: row.orgId, already: !added }
  })
}

