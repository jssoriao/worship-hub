/**
 * /api/church/ai: Music.AI for the signed-in church, for people who may run it (owners for now: the
 * `musicai:run` permission). Nothing here calls Music.AI yet; this is the credits side.
 *
 *   GET  /api/church/ai            this month's credits (used, limit, remaining, the platform cap) and the latest jobs
 *   POST /api/church/ai/estimate   {pieces, seconds, language?, have?}  the jobs that would run, what they cost, and whether it
 *                                  fits what is left (400 when a split has no stem to start from)
 *
 * Credits are whole cents per UTC calendar month. A church's plan gives its limit (src/shared/plans.ts; the platform admin can set an own one) and all churches
 * together have a cap (default $30), both set by the platform admin with `pnpm ai`. When either is used up,
 * jobs wait for the next month. A job holds its estimate before it starts (data.reserveAi) and gives it back
 * if it fails.
 */
import { Hono } from 'hono'
import * as z from 'zod'
import { isPieceId, LANGUAGES, MAX_SECONDS, PIECES, planJobs, type PieceId } from '../shared/ai-pieces.ts'
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
  language: z.enum(LANGUAGES).default('en'),
  /** what the song has already (a preview; a real run reads it from the song) */
  have: z.object({ vocals: z.boolean().optional(), drums: z.boolean().optional(), guitars: z.boolean().optional() }).default({}),
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
    const { pieces, seconds, language, have } = c.req.valid('json')
    const plan = planJobs(pieces as PieceId[], seconds, language, have)
    if (!plan.ok) return c.json({ error: plan.reason }, 400)
    const usage = await data.aiUsage(c.get('deps').db, orgId)
    const totalCents = plan.totalCents
    const left = Math.min(usage.remainingCents, Math.max(0, usage.platform.capCents - usage.platform.usedCents))
    return c.json({
      items: plan.jobs.map((j) => ({ piece: j.piece, workflow: j.workflow, provides: j.provides, cents: j.cents, afterStems: j.afterStems })),
      totalCents,
      remainingCents: usage.remainingCents,
      fits: totalCents <= left,
      reason: totalCents <= left ? null : totalCents > usage.remainingCents ? ('church' as const) : ('platform' as const),
    })
  })
