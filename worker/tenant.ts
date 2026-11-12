/**
 * Who is asking, and for which church. The session says who and which church is active; the role is
 * ALWAYS read from the `member` table (not from a cookie), so removing a member or changing a role
 * applies within the memo TTL (30 s) instead of the 5 minute cookie cache.
 */
import { can, type Request as Permission, type Role } from '../shared/permissions.ts'
import { memberRole, memo, type Db, type Memo } from './data.ts'

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

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

/**
 * 401 no session, 409 no active church (the app then picks one), 403 not a member of the active church.
 * `headers` carries a refreshed session cookie to add to the response.
 */
export async function requireChurch(auth: SessionSource, db: Db, request: { headers: Headers }, cache: Memo = memo): Promise<{ tenant: Tenant; headers: Headers } | { error: Response }> {
  const session = await auth.api.getSession({ headers: request.headers, returnHeaders: true })
  if (!session.response) return { error: json({ error: 'unauthorized' }, 401) }
  const { user, session: s } = session.response
  const orgId = s.activeOrganizationId
  if (!orgId) return { error: json({ error: 'no-active-church' }, 409) }
  const role = await memberRole(db, user.id, orgId, cache)
  if (!role) return { error: json({ error: 'forbidden' }, 403) }
  return {
    tenant: { user: { id: user.id, name: user.name ?? '', email: user.email ?? '' }, orgId, role, platformAdmin: user.platformAdmin === true },
    headers: session.headers,
  }
}

/** The one place a request is checked against a permission. */
export const allowed = (tenant: Pick<Tenant, 'role'>, permission: Permission) => can(tenant.role, permission)

/** Paths of the Better Auth organization plugin the app uses. The plugin has more (create, invite, ...) which stay closed. */
const ORG_ALLOWED = new Set(['set-active', 'list', 'get-active-member', 'get-active-member-role', 'has-permission'])

/** False for organization endpoints the app does not use: churches and members are added by the CLI only. */
export function authPathAllowed(pathname: string): boolean {
  const path = pathname.toLowerCase().replace(/\/{2,}/g, '/').replace(/\/+$/, '')
  if (!path.startsWith('/api/auth/organization')) return true
  const m = /^\/api\/auth\/organization\/(.*)$/.exec(path)
  return !!m && ORG_ALLOWED.has(m[1])
}
