/**
 * Better Auth configuration. The tables are Drizzle tables in src/db/schema/auth.ts, created by the
 * app's migrations; test/auth-schema.test.ts checks they match what this configuration needs.
 *
 * Invite-only, emailed 6-digit code only: there is no password sign-in and no self sign-up.
 * A church is a Better Auth organization; people are in it through `member` rows. Churches and members
 * are added with `pnpm churches add` / `pnpm members add` only (no self sign-up, no user-created churches).
 */
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { emailOTP, organization } from 'better-auth/plugins'
import type { Db } from '../db/client.ts'
import * as schema from '../db/schema/index.ts'
import { ac, roles } from '../shared/permissions.ts'
import { ID_PREFIX, newId, type IdKind } from '../shared/ids.ts'

/** The id kind of a Better Auth model; a model without one (a new plugin table) needs a prefix in ID_PREFIX first. */
function idKindOf(model: string): IdKind {
  if (Object.hasOwn(ID_PREFIX, model)) return model as IdKind
  throw new Error(`No id prefix for the Better Auth model "${model}": add one to ID_PREFIX in src/shared/ids.ts`)
}

export const CODE_MINUTES = 10

export type AuthDeps = {
  /** Public origin of the app. Also the only trusted origin. */
  baseURL: string
  secret: string
  /** The database. In the Worker it stands for the current request's connection (see auth.ts). */
  db: Db
  /**
   * Called for every sign-in request, member or not. The caller decides whether to send mail,
   * so the HTTP response never reveals whether an address is registered.
   */
  sendCode: (email: string, code: string) => void
  /** Keeps work running after the response is sent (ctx.waitUntil in the Worker). */
  background: (task: Promise<unknown>) => void
}

type Adapter = {
  findMany<T>(args: { model: string; where?: { field: string; value: unknown }[]; sortBy?: { field: string; direction: 'asc' | 'desc' }; limit?: number }): Promise<T[]>
}

export function authOptions(deps: AuthDeps) {
  return {
    baseURL: deps.baseURL,
    secret: deps.secret,
    // tables are looked up by their plural export names (users, sessions, ...) and columns by TypeScript name
    database: drizzleAdapter(deps.db, { provider: 'pg', schema, usePlural: true }),
    trustedOrigins: [deps.baseURL],

    user: {
      additionalFields: {
        // The platform super admin (outside any church): runs Music.AI, manages any church from the CLI.
        // input:false = a client can never set it; only src/cli/members.ts does.
        platformAdmin: { type: 'boolean' as const, required: false, defaultValue: false, input: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // Sign in lands in the person's (earliest) church. Several churches: the app offers a switcher.
          before: async (session: { userId: string }, ctx: unknown) => {
            const adapter = (ctx as { context?: { adapter?: Adapter } } | null)?.context?.adapter
            if (!adapter) return
            const first = await adapter.findMany<{ organizationId: string }>({
              model: 'member',
              where: [{ field: 'userId', value: session.userId }],
              sortBy: { field: 'createdAt', direction: 'asc' },
              limit: 1,
            })
            return { data: { ...session, activeOrganizationId: first[0]?.organizationId ?? null } }
          },
        },
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 30, // stay signed in for 30 days
      updateAge: 60 * 60 * 24, // and extend the session when used, at most once a day
      // A signed cookie lets /songs/* range requests skip the database. Removing a member
      // therefore takes up to maxAge to apply to sessions that are already open.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },

    rateLimit: {
      enabled: true,
      storage: 'database' as const, // in-memory counters are useless across Workers isolates
      window: 60,
      max: 60,
      customRules: { '/get-session': false as const },
    },

    advanced: {
      cookiePrefix: 'worship-hub',
      useSecureCookies: deps.baseURL.startsWith('https://'),
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      database: {
        // A fresh auth instance per isolate would otherwise re-inspect the schema on every request
        validateSchema: false,
        // every id is `<prefix>_<24 chars>` (src/shared/ids.ts), the same as the app's own tables
        generateId: ({ model }: { model: string }) => newId(idKindOf(model)),
      },
      backgroundTasks: { handler: deps.background },
    },

    plugins: [
      organization({
        ac,
        roles,
        creatorRole: 'owner' as const,
        // churches are made by the CLI, never by a user
        allowUserToCreateOrganization: false,
      }),
      emailOTP({
        otpLength: 6,
        expiresIn: CODE_MINUTES * 60,
        // Wrong guesses allowed per code; after that the code is dead and a new one is needed
        allowedAttempts: 3,
        // Blocks account creation when a code is redeemed. The sender below still checks
        // membership itself, so strangers never get an email.
        disableSignUp: true,
        storeOTP: 'hashed',
        sendVerificationOTP: async ({ email, otp, type }) => {
          // Only sign-in codes exist in this app; password reset and email change are not enabled
          if (type === 'sign-in') deps.sendCode(email, otp)
        },
      }),
    ],
  }
}
