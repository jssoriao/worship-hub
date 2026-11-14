import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../src/db/client.ts'
import * as data from '../src/api/data.ts'
import { parseDollars } from '../src/cli/lib/money.ts'
import { dollars, estimateCents, MAX_SECONDS, pieceCents, PIECES, lyricsWorkflow } from '../src/shared/ai-pieces.ts'
import { testApp } from './app.ts'
import { freshDb, seedChurch, seedMember, seedUser } from './helpers.ts'

const A = 'org_aaaaaaaaaaaaaaaaaaaaaaaa'
const B = 'org_bbbbbbbbbbbbbbbbbbbbbbbb'
const NOV = new Date('2026-11-14T10:00:00Z')
const job = (cents: number, extra: Partial<data.AiReservation> = {}): data.AiReservation => ({ userId: 'owner-a', songId: null, piece: 'chords', workflow: 'worship-hub-chords', seconds: 300, cents, ...extra })

let db: Db
let pg: Awaited<ReturnType<typeof freshDb>>['pg']
beforeEach(async () => {
  ;({ pg, db } = await freshDb())
  await seedChurch(pg, A, 'a')
  await seedChurch(pg, B, 'b')
  for (const role of ['member', 'editor', 'admin', 'owner']) {
    await seedUser(pg, `${role}-a`)
    await seedMember(pg, A, `${role}-a`, role)
  }
  await seedUser(pg, 'owner-b')
  await seedMember(pg, B, 'owner-b', 'owner')
})

describe('pieces and prices', () => {
  it('prices each piece by the minute, rounded up, never below a cent', () => {
    expect(pieceCents('chords', 60)).toBe(4)
    expect(pieceCents('chords', 90)).toBe(6)
    expect(pieceCents('chords', 1)).toBe(1)
    expect(estimateCents(['beats', 'chords'], 300)).toBe(15 + 20)
  })
  it('has the default four ticked and the stems and splits off, with unique ids', () => {
    expect(PIECES.filter((p) => p.defaultOn).map((p) => p.id)).toEqual(['lyrics', 'beats', 'chords', 'sections'])
    expect(new Set(PIECES.map((p) => p.id)).size).toBe(PIECES.length)
    expect(lyricsWorkflow('tl')).toBe('worship-hub-lyrics-tl')
    expect(lyricsWorkflow('en', true)).toBe('worship-hub-lyrics-from-vocals-en')
    expect(dollars(1050)).toBe('$10.50')
  })
  it('reads dollars as whole cents and refuses the rest', () => {
    expect(parseDollars('10')).toBe(1000)
    expect(parseDollars('$7.25')).toBe(725)
    expect(parseDollars('0.5')).toBe(50)
    for (const bad of ['-1', '1.234', 'ten', '', undefined, '1e3']) expect(() => parseDollars(bad)).toThrow('not an amount')
  })
})

describe('credits', () => {
  it('start at the default limit and the default cap, and count this month only', async () => {
    const u = await data.aiUsage(db, A, NOV)
    expect(u).toMatchObject({ month: '2026-11', limitCents: 1000, usedCents: 0, remainingCents: 1000, platform: { capCents: 3000, usedCents: 0, paused: false } })
    await data.reserveAi(db, A, job(300), new Date('2026-10-31T23:59:59Z'))
    await data.reserveAi(db, A, job(200), new Date('2026-11-01T00:00:00Z'))
    expect((await data.aiUsage(db, A, NOV)).usedCents).toBe(200)
    expect((await data.aiUsage(db, A, new Date('2026-10-15T00:00:00Z'))).usedCents).toBe(300)
    expect((await data.aiUsage(db, A, new Date('2026-12-01T00:00:00Z'))).usedCents).toBe(0) // the next month starts empty
  })

  it('refuses a job that does not fit the church limit, and says what is left', async () => {
    expect((await data.reserveAi(db, A, job(900), NOV)).ok).toBe(true)
    expect(await data.reserveAi(db, A, job(101), NOV)).toEqual({ ok: false, reason: 'church', remainingCents: 100 })
    expect((await data.reserveAi(db, A, job(100), NOV)).ok).toBe(true) // exactly what is left fits
    expect(await data.reserveAi(db, A, job(1), NOV)).toEqual({ ok: false, reason: 'church', remainingCents: 0 })
    // another church has its own month
    expect((await data.reserveAi(db, B, job(1000, { userId: 'owner-b' }), NOV)).ok).toBe(true)
  })

  it('uses a church limit set by the platform admin, and goes back to the default', async () => {
    await data.setAiLimit(db, A, 250)
    expect((await data.aiUsage(db, A, NOV)).limitCents).toBe(250)
    expect((await data.reserveAi(db, A, job(251), NOV)).ok).toBe(false)
    await data.setAiLimit(db, A, 400)
    expect((await data.aiUsage(db, A, NOV)).limitCents).toBe(400)
    await data.setAiLimit(db, A, null)
    expect((await data.aiUsage(db, A, NOV)).limitCents).toBe(1000)
    expect((await data.aiUsage(db, B, NOV)).limitCents).toBe(1000)
  })

  it('pauses every church when the platform cap is reached, even with credits of its own left', async () => {
    await data.setPlatformCap(db, 1500)
    expect((await data.reserveAi(db, A, job(1000), NOV)).ok).toBe(true)
    const b = await data.reserveAi(db, B, job(600, { userId: 'owner-b' }), NOV)
    expect(b).toEqual({ ok: false, reason: 'platform', remainingCents: 500 })
    expect((await data.reserveAi(db, B, job(500, { userId: 'owner-b' }), NOV)).ok).toBe(true)
    const u = await data.aiUsage(db, B, NOV)
    expect(u.platform).toEqual({ capCents: 1500, usedCents: 1500, paused: true })
    expect(u.remainingCents).toBe(500) // its own limit is not used up, the platform is
  })

  it('gives the credits back when a job fails or is cancelled, and keeps them when it ran', async () => {
    const one = (await data.reserveAi(db, A, job(400), NOV)) as { ok: true; id: string }
    const two = (await data.reserveAi(db, A, job(300), NOV)) as { ok: true; id: string }
    const three = (await data.reserveAi(db, A, job(200), NOV)) as { ok: true; id: string }
    expect(await data.settleAiJob(db, A, one.id, { status: 'running', providerJobId: 'prov-1' })).toBe(true)
    expect(await data.settleAiJob(db, A, one.id, { status: 'succeeded' })).toBe(true)
    await data.settleAiJob(db, A, two.id, { status: 'failed', error: 'BAD_INPUT' })
    await data.settleAiJob(db, A, three.id, { status: 'cancelled' })
    expect((await data.aiUsage(db, A, NOV)).usedCents).toBe(400)
    const rows = (await pg.query<{ id: string; status: string; provider_job_id: string | null; started_at: Date | null; finished_at: Date | null; error: string | null }>('select * from ai_jobs order by estimated_cents desc')).rows
    expect(rows[0]).toMatchObject({ id: one.id, status: 'succeeded', provider_job_id: 'prov-1' })
    expect(rows[0].started_at).not.toBeNull()
    expect(rows[0].finished_at).not.toBeNull()
    expect(rows[1]).toMatchObject({ status: 'failed', error: 'BAD_INPUT' })
  })

  it('does not settle a job of another church', async () => {
    const one = (await data.reserveAi(db, A, job(100), NOV)) as { ok: true; id: string }
    expect(await data.settleAiJob(db, B, one.id, { status: 'failed' })).toBe(false)
    expect((await data.aiUsage(db, A, NOV)).usedCents).toBe(100)
  })

  it('cannot be overspent by requests made at the same moment', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => data.reserveAi(db, A, job(300), NOV)))
    expect(results.filter((r) => r.ok)).toHaveLength(3) // 3 x $3 of $10
    expect((await data.aiUsage(db, A, NOV)).usedCents).toBe(900)
  })

  it('keeps the actual cost next to the estimate and lists the latest jobs', async () => {
    await pg.query(`insert into songs (id, organization_id, title) values ('song_aaaaaaaaaaaaaaaaaaaaaaa1', $1, 'Song One')`, [A])
    const one = (await data.reserveAi(db, A, job(400, { songId: 'song_aaaaaaaaaaaaaaaaaaaaaaa1' }), NOV)) as { ok: true; id: string }
    expect(await data.setAiActual(db, one.id, 450)).toBe(true)
    expect(await data.setAiActual(db, 'aij_nope', 1)).toBe(false)
    const jobs = await data.listAiJobs(db, A)
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ id: one.id, piece: 'chords', estimatedCents: 400, actualCents: 450, song: 'Song One', by: 'owner-a' })
    expect(await data.listAiJobs(db, B)).toEqual([])
  })

  it('reports every church, most used first', async () => {
    await data.setAiLimit(db, B, 500)
    await data.reserveAi(db, A, job(100), NOV)
    await data.reserveAi(db, B, job(300, { userId: 'owner-b' }), NOV)
    const r = await data.aiReport(db, NOV)
    expect(r.platform).toEqual({ capCents: 3000, usedCents: 400, paused: false })
    expect(r.churches.map((c) => [c.slug, c.usedCents, c.limitCents])).toEqual([
      ['b', 300, 500],
      ['a', 100, 1000],
    ])
  })
})

describe('/api/church/ai', () => {
  const { call } = testApp(() => ({ db, memo: new data.Memo() }))
  const as = (role: string) => `user=${role}-a; church=${A}`
  const estimate = (who: string | null, body: unknown) => call('/api/church/ai/estimate', who, { method: 'POST', body: JSON.stringify(body) })

  it('is for owners only', async () => {
    expect((await call('/api/church/ai', null)).status).toBe(401)
    for (const role of ['member', 'editor', 'admin']) {
      expect((await call('/api/church/ai', as(role))).status).toBe(403)
      expect((await estimate(as(role), { pieces: ['chords'], seconds: 60 })).status).toBe(403)
    }
    expect((await call('/api/church/ai', as('owner'))).status).toBe(200)
  })

  it('shows this month and the latest jobs', async () => {
    await data.reserveAi(db, A, job(125))
    const res = (await (await call('/api/church/ai', as('owner'))).json()) as { usage: data.AiUsage; jobs: { piece: string }[] }
    expect(res.usage).toMatchObject({ limitCents: 1000, usedCents: 125, remainingCents: 875 })
    expect(res.jobs.map((j) => j.piece)).toEqual(['chords'])
  })

  it('prices a request, and says whether it fits and why not', async () => {
    const ok = await (await estimate(as('owner'), { pieces: ['beats', 'chords'], seconds: 300 })).json()
    expect(ok).toEqual({ items: [{ piece: 'beats', cents: 15 }, { piece: 'chords', cents: 20 }], totalCents: 35, remainingCents: 1000, fits: true, reason: null })
    const big = await (await estimate(as('owner'), { pieces: ['stems'], seconds: 300 })).json()
    expect(big).toMatchObject({ totalCents: 350, fits: true })
    await data.reserveAi(db, A, job(900))
    expect(await (await estimate(as('owner'), { pieces: ['chords'], seconds: 300 })).json()).toMatchObject({ fits: true, remainingCents: 100 })
    expect(await (await estimate(as('owner'), { pieces: ['stems'], seconds: 300 })).json()).toMatchObject({ fits: false, reason: 'church', remainingCents: 100 })
  })

  it('says the platform is the reason when its cap is what is reached', async () => {
    await data.setPlatformCap(db, 100)
    expect(await (await estimate(as('owner'), { pieces: ['chords'], seconds: 300 })).json()).toMatchObject({ fits: true, remainingCents: 1000 })
    await data.setPlatformCap(db, 10)
    expect(await (await estimate(as('owner'), { pieces: ['chords'], seconds: 300 })).json()).toMatchObject({ fits: false, reason: 'platform' })
  })

  it('refuses requests it cannot price', async () => {
    for (const bad of [
      { pieces: [], seconds: 60 },
      { pieces: ['chords', 'chords'], seconds: 60 },
      { pieces: ['magic'], seconds: 60 },
      { pieces: ['chords'], seconds: 0 },
      { pieces: ['chords'], seconds: MAX_SECONDS + 1 },
      { pieces: ['chords'], seconds: 12.5 },
      { seconds: 60 },
    ]) {
      expect((await estimate(as('owner'), bad)).status).toBe(400)
    }
  })
})
