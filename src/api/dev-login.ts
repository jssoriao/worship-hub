/**
 * Local development only: sign in as someone with a given role, with no emailed code.
 *
 *   GET  /api/dev/people    the churches in the database, with who holds each role
 *   POST /api/dev/sign-in   { churchId, role }: a session for the first person with that role in that church
 *                           (a "Dev <Role>" person at <role>.dev@example.test is added there when nobody has it)
 *
 * It answers only when BOTH hold: the variable DEV_LOGIN is "on" (set it in .dev.vars) and APP_URL is a plain
 * http address on this machine (127.0.0.1 or localhost). Production has neither, so there every path here is a
 * 404, the same as any unknown path. The session is a normal Better Auth session row with its signed cookie, so
 * everything after it (roles, church checks, sign-out) works as with an emailed code.
 */
import { and, asc, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { deleteCookie, setSignedCookie } from 'hono/cookie'
import * as z from 'zod'
import { members, organizations, sessions, users } from '../db/schema/index.ts'
import { newId } from '../shared/ids.ts'
import { ROLE_NAMES, isRole } from '../shared/permissions.ts'
import { recordSignIn } from './data.ts'
import type { Bindings } from './env.ts'
import { fail, sameOrigin, type AppEnv } from './tenant.ts'
import { body } from './validate.ts'
/** the session cookie Better Auth reads (cookiePrefix "worship-hub", plain http locally) and its 5-minute cache */
const SESSION_COOKIE = 'worship-hub.session_token'
const CACHE_COOKIE = 'worship-hub.session_data'
const DAYS_30 = 60 * 60 * 24 * 30
type DevEnv = Partial<Pick<Bindings, 'APP_URL' | 'BETTER_AUTH_SECRET'>> & { DEV_LOGIN?: string }
/** Whether this Worker may hand out sessions without a code: only on this machine, and only when asked to. */
export function devLoginEnabled(env: DevEnv | undefined): boolean {
  if (env?.DEV_LOGIN !== 'on' || !env.BETTER_AUTH_SECRET || !env.APP_URL) return false
  try {
    const url = new URL(env.APP_URL)
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  } catch {
    return false
  }
}
const signIn = z.object({ churchId: z.string().min(1).max(64), role: z.string().refine(isRole) })
export const devLogin = new Hono<AppEnv>({ strict: false })
  .use(async (c, next) => {
    if (!devLoginEnabled(c.env as unknown as DevEnv)) return fail(c, 404, 'not found')
    await next()
  })
  .get('/people', async (c) => {
    const db = c.get('deps').db
    const churches = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).orderBy(asc(organizations.name))
    const rows = await db
      .select({ churchId: members.organizationId, role: members.role, name: users.name, email: users.email })
      .from(members)
      .innerJoin(users, eq(users.id, members.userId))
      .orderBy(asc(members.createdAt))
    return c.json({
      roles: [...ROLE_NAMES],
      churches: churches.map((ch) => ({
        id: ch.id,
        name: ch.name,
        // the person each role signs in as (the first one added), or null when the church has nobody with it yet
        people: Object.fromEntries(ROLE_NAMES.map((role) => [role, rows.find((r) => r.churchId === ch.id && r.role === role) ?? null])),
      })),
    })
  })
  .post('/sign-in', sameOrigin, body(signIn), async (c) => {
    const { churchId, role } = c.req.valid('json')
    const db = c.get('deps').db
    const [church] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.id, churchId))
    if (!church) return fail(c, 404, 'No such church')
    let [person] = await db
      .select({ userId: members.userId })
      .from(members)
      .where(and(eq(members.organizationId, churchId), eq(members.role, role)))
      .orderBy(asc(members.createdAt))
      .limit(1)
    if (!person) {
      // nobody has this role here: a made-up person for it (or the one made before, added to this church)
      const email = `${role}.dev@example.test`
      const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email))
      const userId = existing?.id ?? newId('user')
      if (!existing) await db.insert(users).values({ id: userId, name: `Dev ${role[0].toUpperCase()}${role.slice(1)}`, email, emailVerified: true })
      await db
        .insert(members)
        .values({ id: newId('member'), organizationId: churchId, userId, role })
        .onConflictDoUpdate({ target: [members.organizationId, members.userId], set: { role } })
      person = { userId }
    }
    const token = newId('session').slice(5) + newId('session').slice(5)
    await db.insert(sessions).values({
      id: newId('session'),
      token,
      userId: person.userId,
      activeOrganizationId: churchId,
      expiresAt: new Date(Date.now() + DAYS_30 * 1000),
      userAgent: 'dev sign-in',
    })
    await recordSignIn(db, person.userId)
    const env = c.env as unknown as DevEnv
    // a cached session from whoever was signed in before would win for 5 minutes: drop it
    deleteCookie(c, CACHE_COOKIE, { path: '/' })
    await setSignedCookie(c, SESSION_COOKIE, token, env.BETTER_AUTH_SECRET!, { path: '/', httpOnly: true, sameSite: 'Lax', maxAge: DAYS_30 })
    return c.json({ ok: true as const })
  })
