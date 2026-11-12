/**
 * /api/church/members: the signed-in church's people, for admins and owners.
 *
 *   GET    /api/church/members              list
 *   POST   /api/church/members              {email, name?, role}  add (they then sign in with an emailed code)
 *   PATCH  /api/church/members/<id>         {role}                change role
 *   DELETE /api/church/members/<id>                               remove
 *
 * Who may grant or touch which role: owners any; admins only member and editor. Nobody changes or
 * removes themselves here, so a church can never lose its last owner through the app.
 */
import * as data from './data.ts'
import type { Db, Memo } from './data.ts'
import { allowed, requireChurch, type SessionSource, type Tenant } from './tenant.ts'
import { isRole, type Role } from '../shared/permissions.ts'

const MEMBERS_PATH = /^\/api\/church\/members(?:\/([A-Za-z0-9_-]{1,64}))?\/?$/

export const isMembersPath = (pathname: string) => MEMBERS_PATH.test(pathname)

const json = (body: unknown, status: number, extra?: Headers) => {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  for (const cookie of extra?.getSetCookie() ?? []) headers.append('Set-Cookie', cookie)
  return new Response(JSON.stringify(body), { status, headers })
}
const fail = (status: number, error: string) => json({ error }, status)

/** Roles this person may grant, change or remove. */
export const manageableRoles = (role: Role): Role[] => (role === 'owner' ? ['member', 'editor', 'admin', 'owner'] : role === 'admin' ? ['member', 'editor'] : [])

const crossOrigin = (request: Request) => {
  const origin = request.headers.get('Origin')
  return !!origin && origin !== new URL(request.url).origin
}

function parseEmail(value: unknown): string | null {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json()
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export async function routeMembers(request: Request, auth: SessionSource, db: Db, cache?: Memo): Promise<Response> {
  const match = MEMBERS_PATH.exec(new URL(request.url).pathname)
  if (!match) return fail(404, 'not found')
  const memberId = match[1]
  const who = await requireChurch(auth, db, request, cache)
  if ('error' in who) return who.error
  const { tenant, headers } = who
  const method = request.method

  if (method !== 'GET' && crossOrigin(request)) return fail(403, 'forbidden')

  if (!memberId) {
    if (method === 'GET') return allowed(tenant, { member: ['create'] }) ? json({ members: await data.listMembers(db, tenant.orgId), manageable: manageableRoles(tenant.role), me: tenant.user.id }, 200, headers) : fail(403, 'forbidden')
    if (method === 'POST') return add(request, db, tenant, headers)
    return fail(405, 'method not allowed')
  }
  if (method === 'PATCH') return change(request, db, tenant, memberId, headers, cache)
  if (method === 'DELETE') return remove(db, tenant, memberId, headers, cache)
  return fail(405, 'method not allowed')
}

async function add(request: Request, db: Db, tenant: Tenant, headers: Headers): Promise<Response> {
  if (!allowed(tenant, { member: ['create'] })) return fail(403, 'forbidden')
  const body = await readBody(request)
  const email = parseEmail(body?.email)
  if (!email) return fail(400, 'Enter a valid email address')
  const role = body?.role ?? 'member'
  if (!isRole(role) || !manageableRoles(tenant.role).includes(role)) return fail(403, 'You cannot give that role')
  const rawName = typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : ''
  const added = await data.addMember(db, tenant.orgId, email, rawName || email.split('@')[0], role)
  if (added === 'exists') return fail(409, 'That person is already in this church')
  return json(added, 201, headers)
}

async function change(request: Request, db: Db, tenant: Tenant, memberId: string, headers: Headers, cache?: Memo): Promise<Response> {
  if (!allowed(tenant, { member: ['update'] })) return fail(403, 'forbidden')
  const body = await readBody(request)
  const role = body?.role
  if (!isRole(role)) return fail(400, 'Pick a role')
  const target = await data.getMember(db, tenant.orgId, memberId)
  if (!target) return fail(404, 'not found')
  if (target.userId === tenant.user.id) return fail(403, 'You cannot change your own role')
  const may = manageableRoles(tenant.role)
  if (!may.includes(target.role as Role) || !may.includes(role)) return fail(403, 'You cannot give that role')
  const updated = await data.setMemberRole(db, tenant.orgId, memberId, role, cache)
  return updated ? json(updated, 200, headers) : fail(404, 'not found')
}

async function remove(db: Db, tenant: Tenant, memberId: string, headers: Headers, cache?: Memo): Promise<Response> {
  if (!allowed(tenant, { member: ['delete'] })) return fail(403, 'forbidden')
  const target = await data.getMember(db, tenant.orgId, memberId)
  if (!target) return fail(404, 'not found')
  if (target.userId === tenant.user.id) return fail(403, 'You cannot remove yourself')
  if (!manageableRoles(tenant.role).includes(target.role as Role)) return fail(403, 'You cannot remove this person')
  if (!(await data.removeMember(db, tenant.orgId, memberId, cache))) return fail(404, 'not found')
  return json({ ok: true }, 200, headers)
}
