/**
 * Who may do what, as permission bundles. Code asks `can(role, { content: ['edit'] })`; it never
 * compares role names. Shared by the Worker (enforces), the app (shows or hides controls) and the
 * Better Auth organization plugin (its own endpoints need the default statements).
 *
 *   member  plays songs; makes their own arrangements
 *   editor  member + edits chords, lyrics, sections, charts, song details; manages any arrangement
 *   admin   editor + adds and archives songs; manages members and editors
 *   owner   admin + church settings; grants and revokes admin and owner
 *
 * `ai:run` (Music.AI credits) is in no church role: only the platform super admin
 * (user.platformAdmin) runs it, from the CLI.
 */
import { createAccessControl, type AccessControl } from 'better-auth/plugins/access'
import { adminAc, defaultStatements, memberAc, ownerAc } from 'better-auth/plugins/organization/access'

export const statement = {
  ...defaultStatements,
  song: ['read', 'create', 'archive'],
  content: ['edit'],
  arrangement: ['create', 'manage'],
  staff: ['assign'],
  ai: ['run'],
} as const

// named type, so the declaration the web app reads (tsconfig.worker.json) keeps the same type as the source
export const ac: AccessControl<typeof statement> = createAccessControl(statement)

const member = ac.newRole({ ...memberAc.statements, song: ['read'], arrangement: ['create'] })
const editor = ac.newRole({ ...memberAc.statements, song: ['read'], arrangement: ['create', 'manage'], content: ['edit'] })
const admin = ac.newRole({
  ...adminAc.statements,
  song: ['read', 'create', 'archive'],
  arrangement: ['create', 'manage'],
  content: ['edit'],
})
const owner = ac.newRole({
  ...ownerAc.statements,
  song: ['read', 'create', 'archive'],
  arrangement: ['create', 'manage'],
  content: ['edit'],
  staff: ['assign'],
})

export const roles = { member, editor, admin, owner }
export type Role = keyof typeof roles
export const ROLE_NAMES = Object.keys(roles) as Role[]

export type Request = Parameters<(typeof roles)['member']['authorize']>[0]

export const isRole = (value: unknown): value is Role => typeof value === 'string' && Object.hasOwn(roles, value)

/** True when the role's bundle includes every permission asked for. Unknown roles can do nothing. */
export function can(role: unknown, request: Request): boolean {
  return isRole(role) && roles[role].authorize(request).success
}
