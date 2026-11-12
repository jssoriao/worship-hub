import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../src/db/client.ts'
import { Memo } from '../src/api/data.ts'
import { manageableRoles } from '../src/api/members.ts'
import { testApp } from './app.ts'
import { freshDb, seedChurch, seedMember, seedSession, seedUser } from './helpers.ts'

const A = 'org_aaaaaaaaaaaaaaaaaaaaaaaa'
const B = 'org_bbbbbbbbbbbbbbbbbbbbbbbb'

let db: Db
let pg: Awaited<ReturnType<typeof freshDb>>['pg']
let cache: Memo

const as = (user: string, church = A) => `user=${user}; church=${church}`
const app = testApp(() => ({ db, memo: cache }))
const call = (who: string | null, method: string, path = '', body?: unknown, headers: Record<string, string> = {}) =>
  app.call(`/api/church/members${path}`, who, { method, body: body === undefined ? undefined : JSON.stringify(body), headers })
const memberId = async (user: string, church = A) => (await pg.query<{ id: string }>('select id from members where user_id = $1 and organization_id = $2', [user, church])).rows[0]?.id

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
})

describe('paths and roles', () => {

  it('lets owners manage every role and admins only members and editors', () => {
    expect(manageableRoles('owner')).toEqual(['member', 'editor', 'admin', 'owner'])
    expect(manageableRoles('admin')).toEqual(['member', 'editor'])
    expect(manageableRoles('editor')).toEqual([])
    expect(manageableRoles('member')).toEqual([])
  })
})

describe('access', () => {
  it('needs a session', async () => {
    expect((await call(null, 'GET')).status).toBe(401)
  })

  it('refuses members and editors', async () => {
    for (const user of ['member', 'editor']) {
      expect((await call(as(user), 'GET')).status).toBe(403)
      expect((await call(as(user), 'POST', '', { email: 'x@example.com' })).status).toBe(403)
      expect((await call(as(user), 'DELETE', `/${await memberId('admin')}`)).status).toBe(403)
    }
  })

  it('lists only the active church', async () => {
    const res = await call(as('admin'), 'GET')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { members: { userId: string }[]; manageable: string[]; me: string }
    expect(body.members.map((m) => m.userId).sort()).toEqual(['admin', 'editor', 'member', 'owner'])
    expect(body.manageable).toEqual(['member', 'editor'])
    expect(body.me).toBe('admin')
  })

  it('does not reach another church by member id', async () => {
    const bobInB = await memberId('bob', B)
    expect((await call(as('owner'), 'PATCH', `/${bobInB}`, { role: 'member' })).status).toBe(404)
    expect((await call(as('owner'), 'DELETE', `/${bobInB}`)).status).toBe(404)
    expect(await memberId('bob', B)).toBe(bobInB)
  })

  it('refuses writes from another origin', async () => {
    const res = await call(as('owner'), 'POST', '', { email: 'x@example.com' }, { Origin: 'https://evil.test' })
    expect(res.status).toBe(403)
    expect((await pg.query('select 1 from users where email = $1', ['x@example.com'])).rows).toHaveLength(0)
  })
})

describe('adding', () => {
  it('adds a new person, lowercasing the email and defaulting the name', async () => {
    const res = await call(as('admin'), 'POST', '', { email: ' New.Person@Example.com ', role: 'editor' })
    expect(res.status).toBe(201)
    const m = (await res.json()) as { email: string; name: string; role: string }
    expect(m).toMatchObject({ email: 'new.person@example.com', name: 'new.person', role: 'editor' })
  })

  it('adds an existing person from another church without touching their other membership', async () => {
    const res = await call(as('owner'), 'POST', '', { email: 'bob@example.com', role: 'member' })
    expect(res.status).toBe(201)
    expect(await memberId('bob', B)).toBeTruthy()
    expect(await memberId('bob', A)).toBeTruthy()
  })

  it('refuses a duplicate, a bad address and a role the actor may not give', async () => {
    expect((await call(as('admin'), 'POST', '', { email: 'member@example.com' })).status).toBe(409)
    expect((await call(as('admin'), 'POST', '', { email: 'not-an-email' })).status).toBe(400)
    expect((await call(as('admin'), 'POST', '', {})).status).toBe(400)
    expect((await call(as('admin'), 'POST', '', { email: 'a@example.com', role: 'admin' })).status).toBe(403)
    expect((await call(as('admin'), 'POST', '', { email: 'a@example.com', role: 'owner' })).status).toBe(403)
    expect((await call(as('admin'), 'POST', '', { email: 'a@example.com', role: 'superuser' })).status).toBe(403)
  })

  it('lets an owner give any role', async () => {
    expect((await call(as('owner'), 'POST', '', { email: 'a@example.com', role: 'admin' })).status).toBe(201)
    expect((await call(as('owner'), 'POST', '', { email: 'b@example.com', role: 'owner' })).status).toBe(201)
  })
})

describe('changing a role', () => {
  it('lets an admin move members and editors between member and editor only', async () => {
    const id = await memberId('member')
    expect((await call(as('admin'), 'PATCH', `/${id}`, { role: 'editor' })).status).toBe(200)
    expect((await pg.query('select role from members where id = $1', [id])).rows[0]).toEqual({ role: 'editor' })
    expect((await call(as('admin'), 'PATCH', `/${id}`, { role: 'admin' })).status).toBe(403)
  })

  it('stops an admin from touching admins and owners', async () => {
    expect((await call(as('admin'), 'PATCH', `/${await memberId('owner')}`, { role: 'member' })).status).toBe(403)
    expect((await call(as('admin'), 'PATCH', `/${await memberId('editor')}`, { role: 'owner' })).status).toBe(403)
  })

  it('lets an owner promote and demote others', async () => {
    const id = await memberId('editor')
    expect((await call(as('owner'), 'PATCH', `/${id}`, { role: 'admin' })).status).toBe(200)
    expect((await call(as('owner'), 'PATCH', `/${id}`, { role: 'member' })).status).toBe(200)
  })

  it('never lets anyone change their own role', async () => {
    expect((await call(as('owner'), 'PATCH', `/${await memberId('owner')}`, { role: 'member' })).status).toBe(403)
    expect((await call(as('admin'), 'PATCH', `/${await memberId('admin')}`, { role: 'owner' })).status).toBe(403)
  })

  it('rejects a bad role or an unknown member', async () => {
    expect((await call(as('owner'), 'PATCH', `/${await memberId('editor')}`, { role: 'god' })).status).toBe(400)
    expect((await call(as('owner'), 'PATCH', '/nosuchmember', { role: 'member' })).status).toBe(404)
  })

  it('applies at once to the person whose role changed', async () => {
    // the Worker reads the role from the database, not from a cookie; the memo is cleared on the writing isolate
    expect((await call(as('editor'), 'GET')).status).toBe(403)
    await call(as('owner'), 'PATCH', `/${await memberId('editor')}`, { role: 'admin' })
    expect((await call(as('editor'), 'GET')).status).toBe(200)
  })
})

describe('removing', () => {
  it('removes a person who is in no other church, with their sessions and account', async () => {
    await seedSession(pg, 's1', 'member', A)
    await pg.query(`insert into accounts (id, account_id, provider_id, user_id) values ('a1', 'member', 'email-otp', 'member')`)
    expect((await call(as('admin'), 'DELETE', `/${await memberId('member')}`)).status).toBe(200)
    expect((await pg.query(`select 1 from users where id = 'member'`)).rows).toHaveLength(0)
    expect((await pg.query(`select 1 from sessions where id = 's1'`)).rows).toHaveLength(0)
    expect((await pg.query(`select 1 from accounts where id = 'a1'`)).rows).toHaveLength(0)
  })

  it('keeps a person who belongs to another church, ending only their sessions here', async () => {
    await seedMember(pg, B, 'editor', 'member')
    await seedSession(pg, 'sa', 'editor', A)
    await seedSession(pg, 'sb', 'editor', B)
    expect((await call(as('admin'), 'DELETE', `/${await memberId('editor')}`)).status).toBe(200)
    expect(await memberId('editor', A)).toBeUndefined()
    expect(await memberId('editor', B)).toBeTruthy()
    expect((await pg.query(`select id from sessions where user_id = 'editor'`)).rows).toEqual([{ id: 'sb' }])
  })

  it('keeps the platform admin account when they leave their last church', async () => {
    await pg.query(`update users set platform_admin = true where id = 'member'`)
    expect((await call(as('owner'), 'DELETE', `/${await memberId('member')}`)).status).toBe(200)
    expect((await pg.query(`select 1 from users where id = 'member'`)).rows).toHaveLength(1)
  })

  it('denies the removed person straight away', async () => {
    expect((await call(as('admin'), 'GET')).status).toBe(200)
    await call(as('owner'), 'DELETE', `/${await memberId('admin')}`)
    expect((await call(as('admin'), 'GET')).status).toBe(403)
  })

  it('applies the same limits as changing a role', async () => {
    expect((await call(as('admin'), 'DELETE', `/${await memberId('owner')}`)).status).toBe(403)
    expect((await call(as('admin'), 'DELETE', `/${await memberId('admin')}`)).status).toBe(403)
    expect((await call(as('owner'), 'DELETE', `/${await memberId('owner')}`)).status).toBe(403)
    expect((await call(as('owner'), 'DELETE', '/nosuchmember')).status).toBe(404)
  })

  it('lets an owner remove an admin', async () => {
    expect((await call(as('owner'), 'DELETE', `/${await memberId('admin')}`)).status).toBe(200)
  })
})

describe('methods', () => {
  it('answers 405 to anything else', async () => {
    expect((await call(as('owner'), 'PUT')).status).toBe(405)
    expect((await call(as('owner'), 'GET', `/${await memberId('editor')}`)).status).toBe(405)
  })
})
