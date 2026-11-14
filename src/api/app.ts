/**
 * The API as one Hono app. Only these paths reach the Worker (see run_worker_first in wrangler.jsonc);
 * the PWA itself is answered by the static assets layer.
 *
 *   /api/auth/*            Better Auth (emailed sign-in code, sessions, churches the person belongs to)
 *   /api/church/members/*  the active church's people (members.ts)
 *   /api/church/links/*    the active church's join links (links.ts)
 *   /api/church/services/* the active church's services and setlists (services.ts)
 *   /api/church/ai/*       the church's Music.AI credits (ai.ts)
 *   /api/join/*            joining a church through a link, signed out or in (join.ts)
 *   /songs/*               the active church's songs (songs.ts) and their files in R2 (files.ts)
 *
 * `provide` gives each request its database, session source and Better Auth handler: the Worker
 * opens a pool per request (index.ts); tests pass PGlite and fakes.
 */
import { Hono, type Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { ai } from './ai.ts'
import { join } from './join.ts'
import { links } from './links.ts'
import { members } from './members.ts'
import { servicesApp } from './services.ts'
import { songs } from './songs.ts'
import { authPathAllowed, fail, type AppEnv, type Deps } from './tenant.ts'
export type Provide = (c: Context<AppEnv>, run: (deps: Deps) => Promise<void>) => Promise<void>
export function createApp(provide: Provide) {
  return (
    new Hono<AppEnv>({ strict: false })
      .use(async (c, next) => {
        await provide(c, async (deps) => {
          c.set('deps', deps)
          await next()
        })
        // nothing the API answers is for shared caches, unless a route says otherwise (files do)
        if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-store')
      })
      // churches and members are made with the CLI; the organization plugin's other endpoints stay closed
      .on(['GET', 'POST'], '/api/auth/*', async (c) => (authPathAllowed(c.req.path) ? await c.get('deps').authHandler(c.req.raw) : c.json({ error: 'not found' }, 404)))
      .route('/api/church/members', members)
      .route('/api/church/links', links)
      .route('/api/church/services', servicesApp)
      .route('/api/church/ai', ai)
      .route('/api/join', join)
      .route('/songs', songs)
      .notFound((c) => fail(c, 404, 'not found'))
      .onError((error, c) => {
        // malformed JSON bodies and the like; anything else is a bug, logged without personal data
        if (error instanceof HTTPException) return fail(c, error.status, error.message || 'Bad Request')
        console.error('request failed:', error instanceof Error ? error.message : 'unknown error')
        return fail(c, 500, 'Something went wrong')
      })
  )
}
/** The API's routes and types, for the typed client (hono/client). */
export type AppType = ReturnType<typeof createApp>
