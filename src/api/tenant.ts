/**
 * Who is asking, and for which church, as Hono middleware. The session says who and which church is
 * active; the role is ALWAYS read from the `members` table (not from a cookie), so removing a member or
 * changing a role applies within the memo TTL (30 s) instead of the 5 minute cookie cache.
 */
import type { Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { can, type Request as Permission, type Role } from '../shared/permissions.ts'
import { memberRole, songBelongs, type Db, type Memo } from './data.ts'
import type { Bindings } from './env.ts'
export interface Tenant {
  user: { id: string; name: string; email: string }
  orgId: string
  role: Role
  platformAdmin: boolean
}
export interface SessionSource {
  api: {
    getSession(args: { headers: Headers; returnHeaders: true }): Promise<{
      headers: Headers
      response: { session: { activeOrganizationId?: string | null }; user: { id: string; name?: string; email?: string; platformAdmin?: boolean } } | null
    }>
  }
}
/** What a request works with. The Worker builds these per request (index.ts); tests pass PGlite and fakes. */
export interface Deps {
  db: Db
  auth: SessionSource
  memo: Memo
  /** Better Auth's own handler, for /api/auth/* */
  authHandler: (request: Request) => Promise<Response>
}
export type AppEnv = {
  Bindings: Pick<Bindings, 'FILES'>
  Variables: { deps: Deps; tenant: Tenant }
}
/** An error answer: JSON `{ error }` under /api, plain text elsewhere (the /songs/* routes). */
export const fail = (c: Context, status: ContentfulStatusCode, error: string) =>
  c.req.path.startsWith('/api/') ? c.json({ error }, status) : c.text(error, status)
/**
 * 401 no session, 409 no active church (the app then picks one), 403 not a member of the active church.
 * A refreshed session cookie from the check is added to whatever the route answers.
 */
export const church = createMiddleware<AppEnv>(async (c, next) => {
  const { auth, db, memo } = c.get('deps')
  const session = await auth.api.getSession({ headers: c.req.raw.headers, returnHeaders: true })
  if (!session.response) return c.json({ error: 'unauthorized' }, 401)
  const { user, session: s } = session.response
  const orgId = s.activeOrganizationId
  if (!orgId) return c.json({ error: 'no-active-church' }, 409)
  const role = await memberRole(db, user.id, orgId, memo)
  if (!role) return c.json({ error: 'forbidden' }, 403)
  c.set('tenant', { user: { id: user.id, name: user.name ?? '', email: user.email ?? '' }, orgId, role, platformAdmin: user.platformAdmin === true })
  await next()
  for (const cookie of session.headers.getSetCookie()) c.res.headers.append('Set-Cookie', cookie)
})
/** Writes only come from the app's own origin. */
export const sameOrigin = createMiddleware<AppEnv>(async (c, next) => {
  const origin = c.req.header('Origin')
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && origin && origin !== new URL(c.req.url).origin) return fail(c, 403, 'forbidden')
  await next()
})
/** The one place a request is checked against a permission. */
export const allowed = (tenant: Pick<Tenant, 'role'>, permission: Permission) => can(tenant.role, permission)
/** Refuses the request unless the member's role has `permission`. */
export const need = (permission: Permission) =>
  createMiddleware<AppEnv>(async (c, next) => {
    if (!allowed(c.get('tenant'), permission)) return fail(c, 403, 'forbidden')
    await next()
  })
/** The song in the path must belong to the active church before anything else happens with its id. */
export const songOwned = createMiddleware<AppEnv>(async (c, next) => {
  const songId = c.req.param('songId')
  const { db, memo } = c.get('deps')
  if (!songId || !(await songBelongs(db, c.get('tenant').orgId, songId, memo))) return fail(c, 404, 'Not Found')
  await next()
})
/** Paths of the Better Auth organization plugin the app uses. The plugin has more (create, invite, ...) which stay closed. */
const ORG_ALLOWED = new Set(['set-active', 'list', 'get-active-member', 'get-active-member-role', 'has-permission'])
/** False for organization endpoints the app does not use: churches and members are added by the CLI only. */
export function authPathAllowed(pathname: string): boolean {
  const path = pathname.toLowerCase().replace(/\/{2,}/g, '/').replace(/\/+$/, '')
  if (!path.startsWith('/api/auth/organization')) return true
  const m = /^\/api\/auth\/organization\/(.*)$/.exec(path)
  return !!m && ORG_ALLOWED.has(m[1])
}
