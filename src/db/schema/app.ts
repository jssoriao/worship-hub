/**
 * The app's own tables. A song belongs to one church (organization) and is never shared; an
 * arrangement belongs to a song, so it is scoped to the church through it. A service (a gathering with
 * a setlist) belongs to a church; its items are scoped through it. Join links let people add
 * themselves to a church (src/api/join.ts).
 */
import { boolean, check, date, index, integer, jsonb, numeric, pgTable, smallint, text, time, timestamp, unique } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { organizations, users } from './auth.ts'
import { pk } from './ids.ts'

const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

export const songs = pgTable(
  'songs',
  {
    id: pk('song'),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    artist: text('artist'),
    musicKey: text('music_key'),
    bpm: numeric('bpm', { precision: 5, scale: 1, mode: 'number' }),
    meter: smallint('meter'),
    hasStems: boolean('has_stems').notNull().default(false),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: at('created_at').notNull().defaultNow(),
    updatedAt: at('updated_at').notNull().defaultNow(),
    // archived: gone from the library and the pickers, files untouched, restorable. The app never deletes a song.
    archivedAt: at('archived_at'),
    archivedBy: text('archived_by').references(() => users.id, { onDelete: 'set null' }),
  },
  // the unique index leads with organization_id, so it also serves "songs of this church"
  (t) => [unique('songs_organization_id_title_key').on(t.organizationId, t.title)],
)

export const arrangements = pgTable(
  'arrangements',
  {
    id: pk('arrangement'),
    songId: text('song_id')
      .notNull()
      .references(() => songs.id, { onDelete: 'cascade' }),
    ownerId: text('owner_id').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [index('arrangements_song_id_idx').on(t.songId)],
)

/**
 * A link that adds whoever opens it to a church, with a role. Only a SHA-256 hash of the link's secret
 * is kept, so the table alone never gives a working link. A single-use link ends when it is used.
 */
export const joinLinks = pgTable(
  'join_links',
  {
    id: pk('joinLink'),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    singleUse: boolean('single_use').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: at('created_at').notNull().defaultNow(),
    expiresAt: at('expires_at').notNull(),
    /** how many people joined with it */
    uses: smallint('uses').notNull().default(0),
    usedBy: text('used_by').references(() => users.id, { onDelete: 'set null' }),
    usedAt: at('used_at'),
    revokedAt: at('revoked_at'),
  },
  (t) => [index('join_links_organization_id_idx').on(t.organizationId)],
)

/**
 * Someone who opened a join link and asked for a sign-in code: for a short while this address may get a
 * code and get an account (see auth-options.ts), though it has none yet.
 */
export const joinRequests = pgTable(
  'join_requests',
  {
    id: pk('joinRequest'),
    linkId: text('link_id')
      .notNull()
      .references(() => joinLinks.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    expiresAt: at('expires_at').notNull(),
  },
  (t) => [index('join_requests_email_idx').on(t.email)],
)

/** What a line of a service's order is: a song, a plain item (prayer, offering, announcement), or a header that groups the lines under it. */
export type ItemKind = 'song' | 'item' | 'header'
/** A link attached to a setlist item, for example a video to learn the song from. */
export interface ItemLink {
  url: string
  label: string
}
/**
 * A service: one gathering on a date, with an optional time (a church with one service a day leaves it
 * empty). Date and time are wall-clock values, not instants, so "Sunday 9:00" never moves with time zones.
 * The unique index treats a missing time as one value: at most one untimed service per date.
 */
export const services = pgTable(
  'services',
  {
    id: pk('service'),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    time: time('time'),
    title: text('title'),
    notes: text('notes'),
    createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: at('created_at').notNull().defaultNow(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [unique('services_organization_id_date_time_key').on(t.organizationId, t.date, t.time).nullsNotDistinct()],
)
/**
 * One line of a service's order, in `position` order. `kind` song: `songId` points at the church's song and
 * `title` keeps its title as it was when saved, so a deleted song (`songId` empty, still kind song) does not
 * blank the history. Kinds item and header have no song and use `title` as their name. `musicKey` null means
 * "the song's own key".
 */
export const serviceItems = pgTable(
  'service_items',
  {
    id: pk('serviceItem'),
    serviceId: text('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    kind: text('kind').$type<ItemKind>().notNull().default('song'),
    songId: text('song_id').references(() => songs.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    musicKey: text('music_key'),
    notes: text('notes'),
    links: jsonb('links').$type<ItemLink[]>().notNull().default([]),
  },
  (t) => [index('service_items_service_id_position_idx').on(t.serviceId, t.position), check('service_items_kind_check', sql`${t.kind} in ('song', 'item', 'header')`)],
)
