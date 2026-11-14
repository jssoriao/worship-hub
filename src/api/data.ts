/**
 * The only module with queries for church data (songs, arrangements, services, membership, join links, AI credits).
 *
 * Tenancy rule: every function takes the church (`orgId`) first and every query is restricted to it.
 * Arrangements have no church column; they are scoped through their song, so the two can never disagree.
 * Service items likewise are scoped through their service.
 */
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { customAlphabet } from 'nanoid'
import { accounts, aiJobs, aiLimits, appSettings, arrangements, joinLinks, joinRequests, members, organizations, serviceItems, services, sessions, songs, users, type ItemKind, type ItemLink } from '../db/schema/index.ts'
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

/** The church's songs that are not archived: the library. */
export async function listSongs(db: Db, orgId: string): Promise<SongRow[]> {
  return db
    .select(songColumns)
    .from(songs)
    .where(and(eq(songs.organizationId, orgId), isNull(songs.archivedAt)))
    .orderBy(sql`lower(${songs.title})`, asc(songs.id))
}
export interface SongAdminRow extends SongRow {
  /** when it was archived, or null */
  archivedAt: string | null
  archivedBy: string | null
}
/** Every song of the church, archived ones too, for the admin Songs page. */
export async function listSongsAdmin(db: Db, orgId: string): Promise<SongAdminRow[]> {
  const rows = await db
    .select({ ...songColumns, archivedAt: songs.archivedAt, archivedBy: users.name })
    .from(songs)
    .leftJoin(users, eq(users.id, songs.archivedBy))
    .where(eq(songs.organizationId, orgId))
    .orderBy(sql`lower(${songs.title})`, asc(songs.id))
  return rows.map((r) => ({ ...r, archivedAt: r.archivedAt ? iso(r.archivedAt) : null }))
}

export function songBelongs(db: Db, orgId: string, songId: string, cache: Memo = memo): Promise<true | null> {
  return cache.get(`s:${orgId}:${songId}`, async () => {
    const rows = await db
      .select({ id: songs.id })
      .from(songs)
      // an archived song is not found: nothing about it is served or changed until it is restored
      .where(and(eq(songs.organizationId, orgId), eq(songs.id, songId), isNull(songs.archivedAt)))
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

/** Whether the church has an ARCHIVED song with this title (its title is still taken). */
export async function titleIsArchived(db: Db, orgId: string, title: string): Promise<boolean> {
  const rows = await db
    .select({ id: songs.id })
    .from(songs)
    .where(and(eq(songs.organizationId, orgId), eq(songs.title, title), isNotNull(songs.archivedAt)))
    .limit(1)
  return rows.length > 0
}
/** Archives the song (its files stay). False when the church has no such song, or it is archived already. */
export async function archiveSong(db: Db, orgId: string, songId: string, userId: string, cache: Memo = memo): Promise<boolean> {
  const rows = await db
    .update(songs)
    .set({ archivedAt: sql`now()`, archivedBy: userId })
    .where(and(eq(songs.organizationId, orgId), eq(songs.id, songId), isNull(songs.archivedAt)))
    .returning({ id: songs.id })
  cache.clear()
  return rows.length > 0
}
/** Brings an archived song back. False when the church has no such archived song. */
export async function restoreSong(db: Db, orgId: string, songId: string, cache: Memo = memo): Promise<boolean> {
  const rows = await db
    .update(songs)
    .set({ archivedAt: null, archivedBy: null })
    .where(and(eq(songs.organizationId, orgId), eq(songs.id, songId), isNotNull(songs.archivedAt)))
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


// ---------------------------------------------------------------- services
export interface ServiceRow {
  id: string
  /** YYYY-MM-DD */
  date: string
  /** HH:MM, or null when the church has one service that day */
  time: string | null
  title: string | null
  notes: string | null
}
export interface ServiceSummary extends ServiceRow {
  songs: number
}
export interface ItemRow {
  id: string
  kind: ItemKind
  songId: string | null
  title: string
  /** the day's override; null = the song's own key */
  key: string | null
  /** the song's own key (null when it has none, or the song is gone) */
  songKey: string | null
  /** the song is in the church's archive: the line keeps its name, key and links, but nothing of the song is served */
  archived: boolean
  notes: string | null
  links: ItemLink[]
}
export interface ServiceFull extends ServiceRow {
  items: ItemRow[]
}
const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null)
const serviceColumns = {
  id: services.id,
  date: services.date,
  time: services.time,
  title: services.title,
  notes: services.notes,
}
const serviceFrom = (db: Db) => db.select(serviceColumns).from(services)
const toService = <T extends { time: string | null }>(row: T): T => ({ ...row, time: hhmm(row.time) })
/** Every service of the church, newest date first; within a day the untimed one first, then by time. */
export async function listServices(db: Db, orgId: string): Promise<ServiceSummary[]> {
  const rows = await serviceFrom(db)
    .where(eq(services.organizationId, orgId))
    .orderBy(desc(services.date), asc(services.time))
  if (rows.length === 0) return []
  const counts = await db
    .select({ serviceId: serviceItems.serviceId, n: sql<number>`count(*)::int` })
    .from(serviceItems)
    .innerJoin(services, eq(services.id, serviceItems.serviceId))
    .where(and(eq(services.organizationId, orgId), eq(serviceItems.kind, 'song')))
    .groupBy(serviceItems.serviceId)
  const byService = new Map(counts.map((c) => [c.serviceId, c.n]))
  return rows.map((row) => ({ ...toService(row), songs: byService.get(row.id) ?? 0 }))
}
export async function getService(db: Db, orgId: string, serviceId: string): Promise<ServiceFull | null> {
  const [row] = await serviceFrom(db).where(and(eq(services.organizationId, orgId), eq(services.id, serviceId)))
  if (!row) return null
  const items = await db
    .select({
      id: serviceItems.id,
      kind: serviceItems.kind,
      songId: serviceItems.songId,
      title: serviceItems.title,
      key: serviceItems.musicKey,
      songKey: songs.musicKey,
      archivedAt: songs.archivedAt,
      notes: serviceItems.notes,
      links: serviceItems.links,
    })
    .from(serviceItems)
    .leftJoin(songs, and(eq(songs.id, serviceItems.songId), eq(songs.organizationId, orgId)))
    .where(eq(serviceItems.serviceId, serviceId))
    .orderBy(asc(serviceItems.position))
  return { ...toService(row), items: items.map(({ archivedAt, ...item }) => ({ ...item, archived: archivedAt !== null })) }
}
export function serviceBelongs(db: Db, orgId: string, serviceId: string): Promise<boolean> {
  return db
    .select({ id: services.id })
    .from(services)
    .where(and(eq(services.organizationId, orgId), eq(services.id, serviceId)))
    .limit(1)
    .then((rows) => rows.length > 0)
}
export interface ServiceInput {
  date: string
  time: string | null
  title: string | null
  notes: string | null
}
/** 'taken' = a service already has that date and time. */
export async function createService(db: Db, orgId: string, userId: string, input: ServiceInput): Promise<ServiceFull | 'taken'> {
  try {
    const [row] = await db
      .insert(services)
      .values({ organizationId: orgId, date: input.date, time: input.time, title: input.title, notes: input.notes, createdBy: userId })
      .returning({ id: services.id })
    return (await getService(db, orgId, row.id))!
  } catch (error) {
    if (isUniqueViolation(error)) return 'taken'
    throw error
  }
}
/** null = no such service. */
export async function updateService(db: Db, orgId: string, serviceId: string, patch: Partial<ServiceInput>): Promise<ServiceFull | null | 'taken'> {
  const set: Partial<typeof services.$inferInsert> = {}
  if (patch.date !== undefined) set.date = patch.date
  if (patch.time !== undefined) set.time = patch.time
  if (patch.title !== undefined) set.title = patch.title
  if (patch.notes !== undefined) set.notes = patch.notes
  try {
    const rows = await db
      .update(services)
      .set({ ...set, updatedAt: sql`now()` })
      .where(and(eq(services.organizationId, orgId), eq(services.id, serviceId)))
      .returning({ id: services.id })
    return rows.length === 0 ? null : getService(db, orgId, serviceId)
  } catch (error) {
    if (isUniqueViolation(error)) return 'taken'
    throw error
  }
}
export async function deleteService(db: Db, orgId: string, serviceId: string): Promise<boolean> {
  const rows = await db
    .delete(services)
    .where(and(eq(services.organizationId, orgId), eq(services.id, serviceId)))
    .returning({ id: services.id })
  return rows.length > 0
}
/**
 * A new service on another date (and time) with the same title, notes and setlist (songs, keys, notes,
 * links). 'taken' = a service already has that date and time; null = no such service.
 */
export async function cloneService(db: Db, orgId: string, userId: string, serviceId: string, when: { date: string; time: string | null }): Promise<ServiceFull | null | 'taken'> {
  const source = await getService(db, orgId, serviceId)
  if (!source) return null
  try {
    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(services)
        .values({ organizationId: orgId, date: when.date, time: when.time, title: source.title, notes: source.notes, createdBy: userId })
        .returning({ id: services.id })
      if (source.items.length > 0) {
        await tx.insert(serviceItems).values(
          source.items.map((item, position) => ({ serviceId: row.id, position, kind: item.kind, songId: item.songId, title: item.title, musicKey: item.key, notes: item.notes, links: item.links })),
        )
      }
      return row.id
    })
    return getService(db, orgId, id)
  } catch (error) {
    if (isUniqueViolation(error)) return 'taken'
    throw error
  }
}
export interface ItemInput {
  /** an existing item to keep (its place and details change), or none for a new one */
  id?: string
  kind: ItemKind
  /** only for a song */
  songId: string | null
  /** the name of an item or header, and of a song whose own is gone */
  title: string | null
  key: string | null
  notes: string | null
  links: ItemLink[]
}
/**
 * Replaces the order of the service with `items`, in that order. A song in the church's archive cannot be added. Items whose id is listed are updated and keep their
 * id, others are added, and items left out are removed. A song must belong to the church ('song' = one
 * does not); a song line takes the song's current title; the other lines need their own title. A header
 * has no key, notes or links.
 * Everything happens in one transaction.
 */
export async function saveItems(db: Db, orgId: string, serviceId: string, items: ItemInput[]): Promise<ServiceFull | null | 'song' | 'item'> {
  if (!(await serviceBelongs(db, orgId, serviceId))) return null
  const wanted = [...new Set(items.flatMap((i) => (i.kind === 'song' && i.songId ? [i.songId] : [])))]
  const titles = new Map<string, string>()
  if (wanted.length > 0) {
    const found = await db
      .select({ id: songs.id, title: songs.title, archived: songs.archivedAt })
      .from(songs)
      .where(and(eq(songs.organizationId, orgId), inArray(songs.id, wanted)))
    // an archived song cannot be added, but a line that already has it keeps it
    const already = new Set((await db.select({ songId: serviceItems.songId }).from(serviceItems).where(eq(serviceItems.serviceId, serviceId))).flatMap((r) => (r.songId ? [r.songId] : [])))
    for (const song of found) if (!song.archived || already.has(song.id)) titles.set(song.id, song.title)
    if (titles.size !== wanted.length) return 'song'
  }
  const outcome = await db.transaction(async (tx) => {
    const existing = new Set((await tx.select({ id: serviceItems.id }).from(serviceItems).where(eq(serviceItems.serviceId, serviceId))).map((r) => r.id))
    const keep = items.flatMap((i) => (i.id && existing.has(i.id) ? [i.id] : []))
    if (new Set(keep).size !== keep.length) return 'item' as const
    const gone = [...existing].filter((id) => !keep.includes(id))
    if (gone.length > 0) await tx.delete(serviceItems).where(and(eq(serviceItems.serviceId, serviceId), inArray(serviceItems.id, gone)))
    for (const [position, item] of items.entries()) {
      const song = item.kind === 'song' ? item.songId : null
      const header = item.kind === 'header'
      const values = {
        position,
        kind: item.kind,
        songId: song,
        title: song ? titles.get(song)! : (item.title ?? ''),
        musicKey: header ? null : item.key,
        notes: header ? null : item.notes,
        links: header ? [] : item.links,
      }
      if (item.id && existing.has(item.id)) await tx.update(serviceItems).set(values).where(and(eq(serviceItems.serviceId, serviceId), eq(serviceItems.id, item.id)))
      else await tx.insert(serviceItems).values({ ...values, serviceId })
    }
    await tx.update(services).set({ updatedAt: sql`now()` }).where(eq(services.id, serviceId))
    return 'ok' as const
  })
  return outcome === 'ok' ? getService(db, orgId, serviceId) : outcome
}

// ---------------------------------------------------------------- AI credits
/** What a church may spend on Music.AI per month unless it has its own limit: 1000 cents ($10). */
export const AI_DEFAULT_MONTHLY_CENTS = 1000
/** What all churches together may spend per month unless the platform admin set another cap: 3000 cents ($30). */
export const AI_DEFAULT_PLATFORM_CAP_CENTS = 3000
const PLATFORM_CAP_KEY = 'ai.platformCapCents'
/** The first moment of the (UTC) calendar month that `now` is in: when a month's credits start counting. */
export const monthStartUtc = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
const nextMonthStartUtc = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
/** "2026-11" */
export const monthLabel = (now: Date) => `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
/** Jobs that failed or were cancelled give their credits back: they do not count. */
const spent = sql`${aiJobs.status} not in ('failed', 'cancelled')`
type AiQuery = Pick<Db, 'select' | 'insert' | 'update' | 'execute'>

async function usedCents(q: AiQuery, now: Date, orgId?: string): Promise<number> {
  const [row] = await q
    .select({ n: sql<number>`coalesce(sum(${aiJobs.estimatedCents}), 0)::int` })
    .from(aiJobs)
    .where(and(spent, sql`${aiJobs.createdAt} >= ${monthStartUtc(now)}`, sql`${aiJobs.createdAt} < ${nextMonthStartUtc(now)}`, orgId ? eq(aiJobs.organizationId, orgId) : undefined))
  return row.n
}
async function limitCents(q: AiQuery, orgId: string): Promise<number> {
  const [row] = await q.select({ n: aiLimits.monthlyCents }).from(aiLimits).where(eq(aiLimits.organizationId, orgId))
  return row?.n ?? AI_DEFAULT_MONTHLY_CENTS
}
async function platformCap(q: AiQuery): Promise<number> {
  const [row] = await q.select({ v: appSettings.value }).from(appSettings).where(eq(appSettings.key, PLATFORM_CAP_KEY))
  return typeof row?.v === 'number' && Number.isInteger(row.v) && row.v >= 0 ? row.v : AI_DEFAULT_PLATFORM_CAP_CENTS
}

export interface AiUsage {
  /** "2026-11": credits are counted per UTC calendar month */
  month: string
  limitCents: number
  usedCents: number
  remainingCents: number
  platform: { capCents: number; usedCents: number; /** every church waits: the cap over all churches is reached */ paused: boolean }
}
/** What the church has used this month, its limit, and where the platform stands. */
export async function aiUsage(db: Db, orgId: string, now: Date = new Date()): Promise<AiUsage> {
  const [limit, used, cap, platformUsed] = await Promise.all([limitCents(db, orgId), usedCents(db, now, orgId), platformCap(db), usedCents(db, now)])
  return {
    month: monthLabel(now),
    limitCents: limit,
    usedCents: used,
    remainingCents: Math.max(0, limit - used),
    platform: { capCents: cap, usedCents: platformUsed, paused: platformUsed >= cap },
  }
}

export interface AiReservation {
  userId: string | null
  songId: string | null
  piece: string
  workflow: string
  seconds: number
  cents: number
}
export type AiReserved = { ok: true; id: string } | { ok: false; reason: 'church' | 'platform'; remainingCents: number }
/**
 * Holds `cents` for a job, or says why not: the church's month is used up ('church'), or all churches together have
 * reached the platform cap ('platform'). Check and hold happen under one lock, so two requests at once cannot both
 * take the last credits. Give them back by settling the job as failed or cancelled.
 */
export async function reserveAi(db: Db, orgId: string, job: AiReservation, now: Date = new Date()): Promise<AiReserved> {
  return db.transaction(async (tx) => {
    // one lock for every reservation: simple, and a job is rare
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('worship-hub:ai-credits'))`)
    const [limit, used, cap, platformUsed] = await Promise.all([limitCents(tx, orgId), usedCents(tx, now, orgId), platformCap(tx), usedCents(tx, now)])
    if (used + job.cents > limit) return { ok: false, reason: 'church', remainingCents: Math.max(0, limit - used) } as const
    if (platformUsed + job.cents > cap) return { ok: false, reason: 'platform', remainingCents: Math.max(0, Math.min(limit - used, cap - platformUsed)) } as const
    const [row] = await tx
      .insert(aiJobs)
      .values({ organizationId: orgId, userId: job.userId, songId: job.songId, piece: job.piece, workflow: job.workflow, seconds: job.seconds, estimatedCents: job.cents, createdAt: now })
      .returning({ id: aiJobs.id })
    return { ok: true, id: row.id } as const
  })
}

export type AiStatus = 'reserved' | 'running' | 'succeeded' | 'failed' | 'cancelled'
/** Moves a job on (running, then succeeded, failed or cancelled). False when the church has no such job. */
export async function settleAiJob(db: Db, orgId: string, jobId: string, change: { status: AiStatus; providerJobId?: string; error?: string }): Promise<boolean> {
  const done = change.status !== 'running' && change.status !== 'reserved'
  const rows = await db
    .update(aiJobs)
    .set({
      status: change.status,
      ...(change.providerJobId ? { providerJobId: change.providerJobId } : {}),
      ...(change.error ? { error: change.error.slice(0, 500) } : {}),
      ...(change.status === 'running' ? { startedAt: sql`now()` } : {}),
      ...(done ? { finishedAt: sql`now()` } : {}),
    })
    .where(and(eq(aiJobs.organizationId, orgId), eq(aiJobs.id, jobId)))
    .returning({ id: aiJobs.id })
  return rows.length > 0
}

export interface AiJobRow {
  id: string
  piece: string
  status: string
  seconds: number
  estimatedCents: number
  actualCents: number | null
  createdAt: string
  by: string | null
  song: string | null
}
/** The church's latest jobs, newest first. */
export async function listAiJobs(db: Db, orgId: string, limit = 20): Promise<AiJobRow[]> {
  const rows = await db
    .select({
      id: aiJobs.id,
      piece: aiJobs.piece,
      status: aiJobs.status,
      seconds: aiJobs.seconds,
      estimatedCents: aiJobs.estimatedCents,
      actualCents: aiJobs.actualCents,
      createdAt: aiJobs.createdAt,
      by: users.name,
      song: songs.title,
    })
    .from(aiJobs)
    .leftJoin(users, eq(users.id, aiJobs.userId))
    .leftJoin(songs, eq(songs.id, aiJobs.songId))
    .where(eq(aiJobs.organizationId, orgId))
    .orderBy(desc(aiJobs.createdAt))
    .limit(limit)
  return rows.map((r) => ({ ...r, createdAt: iso(r.createdAt) }))
}

// the platform admin's side (scripts): limits, the cap, actual costs, and a report
/** A church's own monthly limit, in cents; null removes it (back to the default). */
export async function setAiLimit(db: Db, orgId: string, cents: number | null): Promise<void> {
  if (cents === null) await db.delete(aiLimits).where(eq(aiLimits.organizationId, orgId))
  else await db.insert(aiLimits).values({ organizationId: orgId, monthlyCents: cents }).onConflictDoUpdate({ target: aiLimits.organizationId, set: { monthlyCents: cents, updatedAt: sql`now()` } })
}
export async function setPlatformCap(db: Db, cents: number): Promise<void> {
  await db.insert(appSettings).values({ key: PLATFORM_CAP_KEY, value: cents }).onConflictDoUpdate({ target: appSettings.key, set: { value: cents, updatedAt: sql`now()` } })
}
/** What a job really cost, from Music.AI's dashboard. False when there is no such job. */
export async function setAiActual(db: Db, jobId: string, cents: number | null): Promise<boolean> {
  const rows = await db.update(aiJobs).set({ actualCents: cents }).where(eq(aiJobs.id, jobId)).returning({ id: aiJobs.id })
  return rows.length > 0
}
export interface AiChurchUsage {
  orgId: string
  slug: string
  name: string
  limitCents: number
  usedCents: number
}
/** Every church's use this month, most first, with the platform's total and cap. */
export async function aiReport(db: Db, now: Date = new Date()): Promise<{ month: string; platform: AiUsage['platform']; churches: AiChurchUsage[] }> {
  const [orgs, used, cap, total] = await Promise.all([
    db
      .select({ orgId: organizations.id, slug: organizations.slug, name: organizations.name, limit: aiLimits.monthlyCents })
      .from(organizations)
      .leftJoin(aiLimits, eq(aiLimits.organizationId, organizations.id)),
    db
      .select({ orgId: aiJobs.organizationId, n: sql<number>`coalesce(sum(${aiJobs.estimatedCents}), 0)::int` })
      .from(aiJobs)
      .where(and(spent, sql`${aiJobs.createdAt} >= ${monthStartUtc(now)}`, sql`${aiJobs.createdAt} < ${nextMonthStartUtc(now)}`))
      .groupBy(aiJobs.organizationId),
    platformCap(db),
    usedCents(db, now),
  ])
  const byOrg = new Map(used.map((u) => [u.orgId, u.n]))
  const churches = orgs
    .map((o) => ({ orgId: o.orgId, slug: o.slug, name: o.name, limitCents: o.limit ?? AI_DEFAULT_MONTHLY_CENTS, usedCents: byOrg.get(o.orgId) ?? 0 }))
    .sort((a, b) => b.usedCents - a.usedCents || a.slug.localeCompare(b.slug))
  return { month: monthLabel(now), platform: { capCents: cap, usedCents: total, paused: total >= cap }, churches }
}
