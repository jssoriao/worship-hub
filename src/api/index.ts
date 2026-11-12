/**
 * Worker entry: the Hono app (app.ts) with a database pool and Better Auth per request (auth.ts).
 */
import { createApp } from './app.ts'
import { withAuth } from './auth.ts'
import * as data from './data.ts'
import type { Bindings } from './env.ts'
import type { SessionSource } from './tenant.ts'
const app = createApp((c, run) =>
  withAuth(c.env as Bindings, c.executionCtx as ExecutionContext, (auth, db) =>
    run({ db, auth: auth as unknown as SessionSource, memo: data.memo, authHandler: (request) => auth.handler(request) }),
  ),
)
export default app satisfies ExportedHandler<Bindings>
