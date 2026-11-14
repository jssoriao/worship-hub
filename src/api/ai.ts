/**
 * /api/church/ai: Music.AI for the signed-in church, for people who may run it (owners for now: the
 * `musicai:run` permission). Nothing here calls Music.AI yet; this is the credits side.
 *
 *   GET  /api/church/ai            this month's credits (used, limit, remaining, the platform cap) and the latest jobs
 *   POST /api/church/ai/estimate   {pieces, seconds}  what that would cost, and whether it fits what is left
 *
 * Credits are whole cents per UTC calendar month. A church has its own limit (default $10) and all churches
 * together have a cap (default $30), both set by the platform admin with `pnpm ai`. When either is used up,
 * jobs wait for the next month. A job holds its estimate before it starts (data.reserveAi) and gives it back
 * if it fails.
 */
import { Hono } from 'hono'
import * as z from 'zod'
import { estimateCents, isPieceId, MAX_SECONDS, pieceCents, PIECES, type PieceId } from '../shared/ai-pieces.ts'
import * as data from './data.ts'
import { church, need, sameOrigin, type AppEnv } from './tenant.ts'
import { body, only } from './validate.ts'

const estimate = z.object({
  pieces: z
    .array(z.string(), { error: 'Pick what to generate' })
    .min(1, 'Pick what to generate')
    .max(PIECES.length)
    .refine((ids) => ids.every(isPieceId) && new Set(ids).size === ids.length, 'Pick what to generate'),
  seconds: z.int({ error: 'Say how long the song is' }).min(1, 'Say how long the song is').max(MAX_SECONDS, `Songs up to ${MAX_SECONDS / 60} minutes only`),
})

export const ai = new Hono<AppEnv>({ strict: false })
  .use(church, sameOrigin)
  .use('/', only('GET'))
  .get('/', need({ musicai: ['run'] }), async (c) => {
    const { orgId } = c.get('tenant')
    const { db } = c.get('deps')
    const [usage, jobs] = await Promise.all([data.aiUsage(db, orgId), data.listAiJobs(db, orgId)])
    return c.json({ usage, jobs })
  })
  .use('/estimate', only('POST'))
  .post('/estimate', need({ musicai: ['run'] }), body(estimate), async (c) => {
    const { orgId } = c.get('tenant')
    const { pieces, seconds } = c.req.valid('json')
    const ids = pieces as PieceId[]
    const usage = await data.aiUsage(c.get('deps').db, orgId)
    const totalCents = estimateCents(ids, seconds)
    const left = Math.min(usage.remainingCents, Math.max(0, usage.platform.capCents - usage.platform.usedCents))
    return c.json({
      items: ids.map((id) => ({ piece: id, cents: pieceCents(id, seconds) })),
      totalCents,
      remainingCents: usage.remainingCents,
      fits: totalCents <= left,
      reason: totalCents <= left ? null : totalCents > usage.remainingCents ? ('church' as const) : ('platform' as const),
    })
  })
