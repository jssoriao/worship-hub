/**
 * Worker entry: the Hono app (app.ts) with a database pool and Better Auth per request (auth.ts).
 * GET responses carry a Server-Timing header (timing.ts). Not other methods: a sign-in request starts
 * background queries for members only, and counting them could tell members from strangers.
 */
import { createApp } from './app.ts'
import { withAuth } from './auth.ts'
import * as data from './data.ts'
import type { Bindings } from './env.ts'
import type { SessionSource } from './tenant.ts'
import { serverTiming, startTiming } from './timing.ts'
const app = createApp(async (c, run) => {
  const timing = c.req.method === 'GET' ? startTiming() : undefined
  await withAuth(
    c.env as Bindings,
    c.executionCtx as ExecutionContext,
    (auth, db) => run({ db, auth: auth as unknown as SessionSource, memo: data.memo, authHandler: (request) => auth.handler(request) }),
    timing,
  )
  if (timing) {
    const colo = (c.req.raw.cf as { colo?: string } | undefined)?.colo
    c.res.headers.append('Server-Timing', serverTiming(timing, colo))
  }
})
export default app satisfies ExportedHandler<Bindings>
