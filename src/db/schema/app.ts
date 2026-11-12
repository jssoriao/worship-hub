/**
 * The app's own tables. A song belongs to one church (organization) and is never shared; an
 * arrangement belongs to a song, so it is scoped to the church through it.
 */
import { boolean, index, jsonb, numeric, pgTable, smallint, text, timestamp, unique } from 'drizzle-orm/pg-core'
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
