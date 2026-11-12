/**
 * Better Auth's tables (core, organization plugin, rate limits) as Drizzle tables.
 *
 * Better Auth's Drizzle adapter looks tables up by these export names (plural, `usePlural: true`) and
 * columns by their TypeScript names, so the database itself can use snake_case. When Better Auth or a
 * plugin changes its schema, `test/auth-schema.test.ts` fails and points at the difference.
 */
import { bigint, boolean, index, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'

const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: at('created_at').notNull().defaultNow(),
  updatedAt: at('updated_at').notNull().defaultNow(),
  // the platform super admin, outside any church; only the CLI sets it (Better Auth: input: false)
  platformAdmin: boolean('platform_admin').notNull().default(false),
})

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: at('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: at('created_at').notNull().defaultNow(),
    updatedAt: at('updated_at').notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // no foreign key, as in Better Auth: a deleted church must not delete sessions (it is cleared instead)
    activeOrganizationId: text('active_organization_id'),
  },
  (t) => [index('sessions_user_id_idx').on(t.userId)],
)

export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: at('access_token_expires_at'),
    refreshTokenExpiresAt: at('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: at('created_at').notNull().defaultNow(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [index('accounts_user_id_idx').on(t.userId)],
)

export const verifications = pgTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: at('expires_at').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
    updatedAt: at('updated_at').notNull().defaultNow(),
  },
  (t) => [index('verifications_identifier_idx').on(t.identifier)],
)

/** A church. */
export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  createdAt: at('created_at').notNull().defaultNow(),
  metadata: text('metadata'),
})

/** A person in a church, with their role there. */
export const members = pgTable(
  'members',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (t) => [unique('members_organization_id_user_id_key').on(t.organizationId, t.userId), index('members_user_id_idx').on(t.userId)],
)

/** Unused (people are added with the CLI or the Members page), but the organization plugin expects it. */
export const invitations = pgTable(
  'invitations',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role'),
    status: text('status').notNull().default('pending'),
    expiresAt: at('expires_at').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [index('invitations_organization_id_idx').on(t.organizationId), index('invitations_email_idx').on(t.email)],
)

/** Better Auth's request counters (database storage: in-memory counters would be per isolate). */
export const rateLimits = pgTable('rate_limits', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
})
