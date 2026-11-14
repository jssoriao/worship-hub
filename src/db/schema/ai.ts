/**
 * Music.AI use: what each church may spend a month, and a ledger of every job. Amounts are whole US cents.
 * The API does not say what a job cost, so the ledger holds our estimate (minutes x the piece's rate, see
 * src/shared/ai-pieces.ts); `actual_cents` is for reconciling with their dashboard by hand.
 */
import { index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { organizations, users } from './auth.ts'
import { songs } from './app.ts'
import { pk } from './ids.ts'

const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

/** A church's own monthly limit; a church without a row has what its plan gives (src/shared/plans.ts). */
export const aiLimits = pgTable('ai_limits', {
  organizationId: text('organization_id')
    .primaryKey()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  monthlyCents: integer('monthly_cents').notNull(),
  updatedAt: at('updated_at').notNull().defaultNow(),
})

/** Platform-wide settings (key, JSON value): today the monthly cap over all churches ("ai.platformCapCents"). */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: at('updated_at').notNull().defaultNow(),
})

/**
 * One Music.AI job. `reserved`: the credits are held and the job is not on its way yet; `running`: Music.AI has it;
 * `succeeded`; `failed` and `cancelled` give the credits back (they do not count towards the month).
 */
export const aiJobs = pgTable(
  'ai_jobs',
  {
    id: pk('aiJob'),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    songId: text('song_id').references(() => songs.id, { onDelete: 'set null' }),
    /** the checklist item, e.g. "chords" (src/shared/ai-pieces.ts) */
    piece: text('piece').notNull(),
    /** the Music.AI workflow slug that ran it */
    workflow: text('workflow').notNull(),
    /** the length of audio it was priced for */
    seconds: integer('seconds').notNull(),
    estimatedCents: integer('estimated_cents').notNull(),
    actualCents: integer('actual_cents'),
    status: text('status').notNull().default('reserved'),
    providerJobId: text('provider_job_id'),
    error: text('error'),
    createdAt: at('created_at').notNull().defaultNow(),
    startedAt: at('started_at'),
    finishedAt: at('finished_at'),
  },
  (t) => [index('ai_jobs_organization_id_created_at_idx').on(t.organizationId, t.createdAt)],
)
