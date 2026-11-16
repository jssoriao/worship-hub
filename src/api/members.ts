/**
 * /api/church/members: the signed-in church's people, for admins and owners.
 *
 *   GET    /api/church/members              list
 *   POST   /api/church/members              {email, name?, role}  add (they then sign in with an emailed code)
 *   PATCH  /api/church/members/<id>         {role?, name?}        change the role and / or the name
 *   DELETE /api/church/members/<id>                               remove
 *
 * Who may grant or touch which role: owners any; admins only member and editor. Nobody changes or
 * removes themselves here, so a church can never lose its last owner through the app. The same people may
 * change a name (and a person may change their own): it is the person's name everywhere, in every church they are in.
 */
import { Hono } from 'hono'
import * as z from 'zod'
import { isRole, type Role } from '../shared/permissions.ts'
import * as data from './data.ts'
import { church, fail, need, sameOrigin, type AppEnv } from './tenant.ts'
import { body, only } from './validate.ts'
/** Roles this person may grant, change or remove. */
export const manageableRoles = (role: Role): Role[] => (role === 'owner' ? ['member', 'editor', 'admin', 'owner'] : role === 'admin' ? ['member', 'editor'] : [])
const MEMBER = '/:memberId'
const EMAIL_MESSAGE = 'Enter a valid email address'
const newMember = z.object({
  email: z
    .string({ error: EMAIL_MESSAGE })
    .transform((v) => v.trim().toLowerCase())
    .pipe(z.string().max(254, EMAIL_MESSAGE).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, EMAIL_MESSAGE)),
  name: z.string().optional(),
  // any string: a role the actor may not give is refused with 403 below, like an unknown one
  role: z.string().optional(),
})
const memberChange = z
  .object({
    role: z.string({ error: 'Pick a role' }).refine(isRole, 'Pick a role').optional(),
    name: z
      .string({ error: 'Give them a name' })
      .transform((v) => v.trim().replace(/\s+/g, ' '))
      .pipe(z.string().min(1, 'Give them a name').max(80, 'That name is too long'))
      .optional(),
  })
  .refine((v) => v.role !== undefined || v.name !== undefined, { message: 'Nothing to change' })
export const members = new Hono<AppEnv>({ strict: false })
  .use(church, sameOrigin)
  .use('/', only('GET', 'POST'))
  .get('/', need({ member: ['create'] }), async (c) => {
    const tenant = c.get('tenant')
    return c.json({ members: await data.listMembers(c.get('deps').db, tenant.orgId), manageable: manageableRoles(tenant.role), me: tenant.user.id })
  })
  .post('/', need({ member: ['create'] }), body(newMember), async (c) => {
    const tenant = c.get('tenant')
    const { email, name, role = 'member' } = c.req.valid('json')
    if (!isRole(role) || !manageableRoles(tenant.role).includes(role)) return fail(c, 403, 'You cannot give that role')
    const added = await data.addMember(c.get('deps').db, tenant.orgId, email, name?.trim().slice(0, 80) || email.split('@')[0], role)
    if (added === 'exists') return fail(c, 409, 'That person is already in this church')
    return c.json(added, 201)
  })
  .use(MEMBER, only('PATCH', 'DELETE'))
  .patch(MEMBER, need({ member: ['update'] }), body(memberChange), async (c) => {
    const tenant = c.get('tenant')
    const { db, memo } = c.get('deps')
    const { role, name } = c.req.valid('json')
    const memberId = c.req.param('memberId')
    const target = await data.getMember(db, tenant.orgId, memberId)
    if (!target) return fail(c, 404, 'not found')
    const may = manageableRoles(tenant.role)
    const mine = target.userId === tenant.user.id
    // check everything first, so a refused change leaves the other one undone too
    if (role !== undefined) {
      if (mine) return fail(c, 403, 'You cannot change your own role')
      if (!may.includes(target.role as Role) || !may.includes(role as Role)) return fail(c, 403, 'You cannot give that role')
    }
    if (name !== undefined && !mine && !may.includes(target.role as Role)) return fail(c, 403, 'You cannot rename this person')
    let updated: data.MemberRow | null = target
    if (name !== undefined) updated = await data.setMemberName(db, tenant.orgId, memberId, name, memo)
    if (updated && role !== undefined) updated = await data.setMemberRole(db, tenant.orgId, memberId, role as Role, memo)
    return updated ? c.json(updated) : fail(c, 404, 'not found')
  })
  .delete(MEMBER, need({ member: ['delete'] }), async (c) => {
    const tenant = c.get('tenant')
    const { db, memo } = c.get('deps')
    const memberId = c.req.param('memberId')
    const target = await data.getMember(db, tenant.orgId, memberId)
    if (!target) return fail(c, 404, 'not found')
    if (target.userId === tenant.user.id) return fail(c, 403, 'You cannot remove yourself')
    if (!manageableRoles(tenant.role).includes(target.role as Role)) return fail(c, 403, 'You cannot remove this person')
    if (!(await data.removeMember(db, tenant.orgId, memberId, memo))) return fail(c, 404, 'not found')
    return c.json({ ok: true as const })
  })
