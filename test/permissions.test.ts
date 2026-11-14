import { describe, expect, it } from 'vitest'
import { can, ROLE_NAMES, statement, type Request } from '../src/shared/permissions.ts'

const all = (): Request[] => {
  const out: Request[] = []
  for (const [resource, actions] of Object.entries(statement)) {
    for (const action of actions) out.push({ [resource]: [action] } as Request)
  }
  return out
}

// every church permission each role has; everything else must be denied
const GRANTED: Record<string, string[]> = {
  member: ['song:read', 'arrangement:create', 'service:read'],
  editor: ['song:read', 'arrangement:create', 'arrangement:manage', 'content:edit', 'service:read', 'service:plan'],
  admin: ['song:read', 'song:create', 'song:archive', 'arrangement:create', 'arrangement:manage', 'content:edit', 'service:read', 'service:plan'],
  owner: ['song:read', 'song:create', 'song:archive', 'arrangement:create', 'arrangement:manage', 'content:edit', 'staff:assign', 'service:read', 'service:plan'],
}
// the organization plugin's own statements are checked separately
const APP = new Set(['song', 'content', 'arrangement', 'staff', 'service', 'ai'])

describe('permissions', () => {
  it('has the four roles', () => {
    expect(ROLE_NAMES.sort()).toEqual(['admin', 'editor', 'member', 'owner'])
  })
  for (const role of Object.keys(GRANTED)) {
    it(`${role}: exactly the expected app permissions`, () => {
      for (const request of all()) {
        const [resource] = Object.keys(request)
        if (!APP.has(resource)) continue
        const [action] = Object.values(request)[0] as string[]
        expect(can(role, request), `${role} ${resource}:${action}`).toBe(GRANTED[role].includes(`${resource}:${action}`))
      }
    })
  }
  it('nobody has ai:run (platform super admin only)', () => {
    for (const role of ROLE_NAMES) expect(can(role, { ai: ['run'] })).toBe(false)
  })
  it('only admin and owner manage members; only owner changes the church', () => {
    expect(can('member', { member: ['create'] })).toBe(false)
    expect(can('editor', { member: ['create'] })).toBe(false)
    expect(can('admin', { member: ['create'] })).toBe(true)
    expect(can('admin', { organization: ['delete'] })).toBe(false)
    expect(can('owner', { organization: ['delete'] })).toBe(true)
  })
  it('denies unknown roles', () => {
    for (const role of ['', 'root', undefined, null, 'constructor', 'toString', 'Owner']) {
      for (const request of all()) expect(can(role, request)).toBe(false)
    }
  })
})

describe('auth options', () => {
  it('platformAdmin can never be set by a client, and no one can create a church', async () => {
    const { authOptions } = await import('../src/api/auth-options.ts')
    const o = authOptions({ baseURL: 'http://x', secret: 's', db: {} as never, sendCode: () => {}, background: () => {} })
    expect(o.user.additionalFields.platformAdmin.input).toBe(false)
    const org = o.plugins.find((p) => p.id === 'organization') as unknown as { options: { allowUserToCreateOrganization: boolean } }
    expect(org.options.allowUserToCreateOrganization).toBe(false)
  })
})
