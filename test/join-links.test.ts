import { betterAuth } from 'better-auth'
import { beforeEach, describe, expect, it } from 'vitest'
import { authOptions } from '../src/api/auth-options.ts'
import { hasJoinRequest, Memo } from '../src/api/data.ts'
import { linkRoles } from '../src/api/links.ts'
import type { Db } from '../src/db/client.ts'
import { testApp } from './app.ts'
import { freshDb, seedChurch, seedMember, seedUser } from './helpers.ts'

const A = 'org_aaaaaaaaaaaaaaaaaaaaaaaa'
const B = 'org_bbbbbbbbbbbbbbbbbbbbbbbb'

let db: Db
let pg: Awaited<ReturnType<typeof freshDb>>['pg']
let cache: Memo

const as = (user: string, church = A) => `user=${user}; church=${church}`
const app = testApp(() => ({ db, memo: cache }))
const json = (body: unknown) => ({ body: JSON.stringify(body) })
const links = (who: string | null, method: string, path = '', body?: unknown) => app.call(`/api/church/links${path}`, who, { method, ...(body === undefined ? {} : json(body)) })
const join = (token: string, who: string | null, method = 'GET', step = '', body?: unknown) => app.call(`/api/join/${token}${step}`, who, { method, ...(body === undefined ? {} : json(body)) })

/** Makes a link as `who` and returns its token. */
async function makeLink(who: string, role: string, singleUse: boolean): Promise<string> {
  const res = await links(as(who), 'POST', '', { role, singleUse })
  expect(res.status).toBe(201)
  const { path } = (await res.json()) as { path: string }
  expect(path).toMatch(/^\/join\/[0-9a-z]{32}$/)
  return path.slice('/join/'.length)
}
const roleIn = async (user: string, church = A) => (await pg.query<{ role: string }>('select role from members where user_id = $1 and organization_id = $2', [user, church])).rows[0]?.role

beforeEach(async () => {
  ;({ pg, db } = await freshDb())
  cache = new Memo()
  await seedChurch(pg, A, 'a')
  await seedChurch(pg, B, 'b')
  for (const role of ['member', 'editor', 'admin', 'owner']) {
    await seedUser(pg, role)
    await seedMember(pg, A, role, role)
  }
  await seedUser(pg, 'bob')
  await seedMember(pg, B, 'bob', 'owner')
  await seedUser(pg, 'newbie')
})

describe('making links', () => {
  it('lets owners give up to admin and admins up to editor; nobody makes owners', () => {
    expect(linkRoles('owner')).toEqual(['member', 'editor', 'admin'])
    expect(linkRoles('admin')).toEqual(['member', 'editor'])
    expect(linkRoles('editor')).toEqual([])
  })

  it('is for admins and owners only, and only for roles they may give', async () => {
    expect((await links(null, 'GET')).status).toBe(401)
    for (const user of ['member', 'editor']) expect((await links(as(user), 'POST', '', { role: 'member', singleUse: true })).status).toBe(403)
    expect((await links(as('admin'), 'POST', '', { role: 'admin', singleUse: true })).status).toBe(403)
    expect((await links(as('owner'), 'POST', '', { role: 'owner', singleUse: false })).status).toBe(403)
    expect((await links(as('owner'), 'POST', '', { role: 'pastor', singleUse: false })).status).toBe(403)
    expect((await links(as('owner'), 'POST', '', { role: 'member' })).status).toBe(400)
  })

  it('keeps only a hash of the secret, and lasts 3 days for one person, 1 day when shared', async () => {
    const single = await makeLink('admin', 'editor', true)
    await makeLink('admin', 'member', false)
    const rows = await pg.query<{ token_hash: string; hours: number; single_use: boolean }>(
      `select token_hash, round(extract(epoch from expires_at - created_at) / 3600)::int as hours, single_use from join_links order by single_use`,
    )
    expect(rows.rows.map((r) => [r.single_use, r.hours])).toEqual([
      [false, 24],
      [true, 72],
    ])
    for (const r of rows.rows) expect(r.token_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(rows.rows)).not.toContain(single)
  })

  it('lists working links per church, and turns them off', async () => {
    await makeLink('admin', 'member', false)
    const list = (await (await links(as('owner'), 'GET')).json()) as { links: { id: string; role: string; createdBy: string }[] }
    expect(list.links).toHaveLength(1)
    expect(list.links[0]).toMatchObject({ role: 'member', createdBy: 'admin' })
    // another church sees none of it, and cannot turn it off
    expect(((await (await links(as('bob', B), 'GET')).json()) as { links: unknown[] }).links).toHaveLength(0)
    expect((await links(as('bob', B), 'DELETE', `/${list.links[0].id}`)).status).toBe(404)
    expect((await links(as('admin'), 'DELETE', `/${list.links[0].id}`)).status).toBe(200)
    expect(((await (await links(as('owner'), 'GET')).json()) as { links: unknown[] }).links).toHaveLength(0)
  })

  it('does not let an admin turn off a link that makes admins', async () => {
    await makeLink('owner', 'admin', true)
    const list = (await (await links(as('owner'), 'GET')).json()) as { links: { id: string }[] }
    expect((await links(as('admin'), 'DELETE', `/${list.links[0].id}`)).status).toBe(403)
  })
})

describe('joining', () => {
  it('shows the church and role, and why a link does not work', async () => {
    const token = await makeLink('admin', 'editor', true)
    const res = await join(token, null)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ church: 'A', role: 'editor', singleUse: true })
    expect((await join('z'.repeat(32), null)).status).toBe(404)
    expect((await join('not-a-token', null)).status).toBe(404)
    await pg.query(`update join_links set expires_at = now() - interval '1 minute'`)
    const expired = await join(token, null)
    expect(expired.status).toBe(410)
    expect(await expired.json()).toEqual({ error: 'This join link has expired' })
  })

  it('adds the signed-in person with the link role, once for a single-use link', async () => {
    const token = await makeLink('admin', 'editor', true)
    expect((await join(token, null, 'POST', '/finish')).status).toBe(401)
    const done = await join(token, as('newbie', 'none'), 'POST', '/finish')
    expect(done.status).toBe(200)
    expect(await done.json()).toEqual({ orgId: A, already: false })
    expect(await roleIn('newbie')).toBe('editor')
    // used up: the next person is told so
    const again = await join(token, as('bob', B), 'POST', '/finish')
    expect(again.status).toBe(410)
    expect(await again.json()).toEqual({ error: 'This join link was already used' })
    expect(await roleIn('bob')).toBeUndefined()
  })

  it('lets many join with a shared link, and adds people from other churches too', async () => {
    const token = await makeLink('owner', 'member', false)
    expect((await join(token, as('newbie', 'none'), 'POST', '/finish')).status).toBe(200)
    expect((await join(token, as('bob', B), 'POST', '/finish')).status).toBe(200)
    expect(await roleIn('newbie')).toBe('member')
    expect(await roleIn('bob')).toBe('member')
    expect(await roleIn('bob', B)).toBe('owner')
    expect((await pg.query<{ uses: number }>('select uses from join_links')).rows[0].uses).toBe(2)
  })

  it('leaves someone already in the church as they are, and the link unused', async () => {
    const token = await makeLink('owner', 'member', true)
    const res = await join(token, as('admin'), 'POST', '/finish')
    expect(await res.json()).toEqual({ orgId: A, already: true })
    expect(await roleIn('admin')).toBe('admin')
    expect((await join(token, null)).status).toBe(200)
  })

  it('does not leave an account in no church when the link stops working after the code', async () => {
    const token = await makeLink('owner', 'member', true)
    // the account the code made, in no church; meanwhile the link was turned off
    await pg.query('update join_links set revoked_at = now()')
    const res = await join(token, as('newbie', 'none'), 'POST', '/finish')
    expect(res.status).toBe(410)
    expect((await pg.query(`select 1 from users where id = 'newbie'`)).rows).toHaveLength(0)
    // someone who is in a church is not touched
    const again = await join(token, as('bob', B), 'POST', '/finish')
    expect(again.status).toBe(410)
    expect((await pg.query(`select 1 from users where id = 'bob'`)).rows).toHaveLength(1)
  })

  it('refuses a link that was turned off', async () => {
    const token = await makeLink('owner', 'member', false)
    await pg.query('update join_links set revoked_at = now()')
    const res = await join(token, as('newbie', 'none'), 'POST', '/finish')
    expect(res.status).toBe(410)
    expect(await roleIn('newbie')).toBeUndefined()
  })

  it('notes an address that opened a working link, for a short while', async () => {
    const token = await makeLink('owner', 'member', false)
    expect((await join(token, null, 'POST', '/start', { email: 'nope' })).status).toBe(400)
    expect((await join(token, null, 'POST', '/start', { email: ' New.Person@Example.com ' })).status).toBe(200)
    expect(await hasJoinRequest(db, 'new.person@example.com')).toBe(true)
    expect(await hasJoinRequest(db, 'someone.else@example.com')).toBe(false)
    // a link that stops working takes its requests with it
    await pg.query('update join_links set revoked_at = now()')
    expect(await hasJoinRequest(db, 'new.person@example.com')).toBe(false)
    expect((await join(token, null, 'POST', '/start', { email: 'x@example.com' })).status).toBe(410)
  })
})

describe('cleaning up', () => {
  const rows = async () => (await pg.query<{ role: string }>('select role from join_links order by role')).rows.map((r) => r.role)

  it('deletes links a week after they ended, whichever way, and keeps the rest', async () => {
    await makeLink('owner', 'member', false) // fine
    await makeLink('owner', 'editor', false) // expired 2 days ago: kept
    await makeLink('owner', 'admin', false) // expired 8 days ago: deleted
    await makeLink('owner', 'member', true) // used 8 days ago: deleted (not expired yet)
    await makeLink('owner', 'editor', true) // turned off 8 days ago: deleted
    const set = (role: string, singleUse: boolean, change: string) =>
      pg.query(`update join_links set ${change} where role = '${role}' and single_use = ${singleUse}`)
    await set('editor', false, `expires_at = now() - interval '2 days'`)
    await set('admin', false, `expires_at = now() - interval '8 days'`)
    await set('member', true, `used_at = now() - interval '8 days'`)
    await set('editor', true, `revoked_at = now() - interval '8 days'`)
    expect(await rows()).toHaveLength(5)
    await links(as('owner'), 'GET')
    expect(await rows()).toEqual(['editor', 'member'])
  })

  it('removes join requests with their link, and any that ran out', async () => {
    const token = await makeLink('owner', 'member', false)
    await join(token, null, 'POST', '/start', { email: 'one@example.com' })
    await join(token, null, 'POST', '/start', { email: 'two@example.com' })
    await pg.query(`update join_requests set expires_at = now() - interval '1 minute' where email = 'one@example.com'`)
    await links(as('owner'), 'GET')
    expect((await pg.query<{ email: string }>('select email from join_requests')).rows).toEqual([{ email: 'two@example.com' }])
    await pg.query(`update join_links set expires_at = now() - interval '8 days'`)
    await links(as('owner'), 'GET')
    expect((await pg.query('select 1 from join_requests')).rows).toHaveLength(0)
  })

  it("only touches the signed-in church's links", async () => {
    await makeLink('owner', 'member', false)
    await pg.query(`update join_links set expires_at = now() - interval '8 days'`)
    await links(as('bob', B), 'GET')
    expect(await rows()).toHaveLength(1)
    await links(as('owner'), 'GET')
    expect(await rows()).toHaveLength(0)
  })
})

describe('signing up through a link (Better Auth)', () => {
  const makeAuth = (sent: { email: string; code: string }[]) =>
    betterAuth(
      authOptions({
        baseURL: 'http://x.test',
        secret: 'x'.repeat(32),
        db,
        sendCode: (email, code) => sent.push({ email, code }),
        background: () => {},
      }),
    )

  it('makes an account only for an address that came through a link', async () => {
    const sent: { email: string; code: string }[] = []
    const auth = makeAuth(sent)
    const signUp = async (email: string) => {
      await auth.api.sendVerificationOTP({ body: { email, type: 'sign-in' } })
      const code = sent.find((s) => s.email === email)!.code
      return auth.api.signInEmailOTP({ body: { email, otp: code } })
    }
    await expect(signUp('stranger@example.com')).rejects.toThrow()
    const token = await makeLink('owner', 'member', false)
    await join(token, null, 'POST', '/start', { email: 'joiner@example.com' })
    const signedIn = await signUp('joiner@example.com')
    expect(signedIn.user.email).toBe('joiner@example.com')
    const users = await pg.query<{ email: string }>(`select email from users where email in ('stranger@example.com', 'joiner@example.com')`)
    expect(users.rows).toEqual([{ email: 'joiner@example.com' }])
  })
})
