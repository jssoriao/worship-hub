/**
 * /api/church/links: join links for the signed-in church, for admins and owners (opened at /join/<token>,
 * see join.ts).
 *
 *   GET    /api/church/links                       the links that still work
 *   POST   /api/church/links  {role, singleUse}    a new link; its address is in this answer only
 *   DELETE /api/church/links/<id>                  turn a link off
 *
 * A link for one person works for 3 days, a shared one for 1 day. Roles follow Members: owners make
 * links up to admin, admins up to editor. No link makes owners.
 */
import { Hono } from 'hono'
import * as z from 'zod'
import { isRole, type Role } from '../shared/permissions.ts'
import * as data from './data.ts'
import { manageableRoles } from './members.ts'
import { church, fail, need, sameOrigin, type AppEnv } from './tenant.ts'
import { body, only } from './validate.ts'

/** Roles this person may put on a link. */
export const linkRoles = (role: Role): Role[] => manageableRoles(role).filter((r) => r !== 'owner')

const newLink = z.object({
  // any string: a role the person may not give is refused with 403 below, like an unknown one
  role: z.string({ error: 'Pick a role' }),
  singleUse: z.boolean({ error: 'Pick who the link is for' }),
})
const LINK = '/:linkId'

export const links = new Hono<AppEnv>({ strict: false })
  .use(church, sameOrigin)
  .use('/', only('GET', 'POST'))
  .get('/', need({ member: ['create'] }), async (c) => {
    const tenant = c.get('tenant')
    return c.json({ links: await data.listJoinLinks(c.get('deps').db, tenant.orgId), roles: linkRoles(tenant.role) })
  })
  .post('/', need({ member: ['create'] }), body(newLink), async (c) => {
    const tenant = c.get('tenant')
    const { role, singleUse } = c.req.valid('json')
    if (!isRole(role) || !linkRoles(tenant.role).includes(role)) return fail(c, 403, 'You cannot give that role')
    const { link, token } = await data.createJoinLink(c.get('deps').db, tenant.orgId, { role, singleUse, createdBy: tenant.user.id })
    // a path: the app adds its own address (behind the dev proxy the Worker's differs)
    return c.json({ link, path: `/join/${token}` }, 201)
  })
  .use(LINK, only('DELETE'))
  .delete(LINK, need({ member: ['create'] }), async (c) => {
    const tenant = c.get('tenant')
    const { db } = c.get('deps')
    const linkId = c.req.param('linkId')
    const role = await data.joinLinkRole(db, tenant.orgId, linkId)
    if (!role) return fail(c, 404, 'not found')
    // an admin cannot turn off a link that makes admins (an owner made it)
    if (!linkRoles(tenant.role).includes(role)) return fail(c, 403, 'You cannot turn off this link')
    await data.revokeJoinLink(db, tenant.orgId, linkId)
    return c.json({ ok: true as const })
  })
