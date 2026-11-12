import { beforeEach, describe, expect, it } from 'vitest'
import { betterAuth } from 'better-auth'
import { authOptions } from '../src/api/auth-options.ts'
import type { Db } from '../src/db/client.ts'
import { freshDb, seedChurch, seedMember, seedUser } from './helpers.ts'

/**
 * Better Auth end to end on the real migrations (snake_case columns, plural tables): an emailed code
 * signs a member in, the session lands in their church, and the session is found again by its cookie.
 */
const CHURCH = 'churchaaaaaa'
const EMAIL = 'singer@example.com'

let db: Db
let pg: Awaited<ReturnType<typeof freshDb>>['pg']
let sent: { email: string; code: string }[]
let tasks: Promise<unknown>[]

const makeAuth = () =>
  betterAuth(
    authOptions({
      baseURL: 'http://x.test',
      secret: 'x'.repeat(32),
      db,
      sendCode: (email, code) => sent.push({ email, code }),
      background: (task) => void tasks.push(task),
    }),
  )

beforeEach(async () => {
  ;({ pg, db } = await freshDb())
  sent = []
  tasks = []
  await seedChurch(pg, CHURCH, 'a')
  await seedUser(pg, 'singer', EMAIL)
  await seedMember(pg, CHURCH, 'singer', 'member')
})

describe('sign-in with an emailed code', () => {
  it('signs a member in, lands in their church, and finds the session by cookie', async () => {
    const auth = makeAuth()
    await auth.api.sendVerificationOTP({ body: { email: EMAIL, type: 'sign-in' } })
    expect(sent).toHaveLength(1)
    const signIn = await auth.api.signInEmailOTP({ body: { email: EMAIL, otp: sent[0].code }, returnHeaders: true })
    const cookie = signIn.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')
    expect(cookie).toContain('worship-hub.session_token=')
    await Promise.all(tasks)

    const session = await auth.api.getSession({ headers: new Headers({ cookie }) })
    expect(session?.user.email).toBe(EMAIL)
    expect(session?.session.activeOrganizationId).toBe(CHURCH)
    const stored = await pg.query<{ user_id: string; active_organization_id: string }>('select user_id, active_organization_id from sessions')
    expect(stored.rows).toEqual([{ user_id: 'singer', active_organization_id: CHURCH }])
    // the code is stored hashed, never as sent
    const codes = await pg.query<{ value: string }>('select value from verifications')
    for (const row of codes.rows) expect(row.value).not.toContain(sent[0].code)
  })

  it('a wrong code does not sign in', async () => {
    const auth = makeAuth()
    await auth.api.sendVerificationOTP({ body: { email: EMAIL, type: 'sign-in' } })
    const wrong = sent[0].code === '000000' ? '111111' : '000000'
    await expect(auth.api.signInEmailOTP({ body: { email: EMAIL, otp: wrong } })).rejects.toThrow()
    expect((await pg.query('select 1 from sessions')).rows).toHaveLength(0)
  })

  it('a stranger cannot sign up with a code', async () => {
    const auth = makeAuth()
    await auth.api.sendVerificationOTP({ body: { email: 'stranger@example.com', type: 'sign-in' } })
    const code = sent.find((s) => s.email === 'stranger@example.com')?.code ?? '123456'
    await expect(auth.api.signInEmailOTP({ body: { email: 'stranger@example.com', otp: code } })).rejects.toThrow()
    expect((await pg.query(`select 1 from users where email = 'stranger@example.com'`)).rows).toHaveLength(0)
  })
})
