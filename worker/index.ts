/**
 * Entry point. Only these paths reach the Worker (see run_worker_first in wrangler.jsonc);
 * the PWA itself is answered by the static assets layer.
 *
 *   /api/auth/*  Better Auth (emailed sign-in code, sessions, churches the person belongs to)
 *   /songs/*     the signed-in member's active church: its song list (Neon) and files (R2)
 *
 * Every /songs/* request resolves the church first (tenant.ts), and a song id is only honoured when
 * the song belongs to that church (data.songBelongs) before any R2 key is built.
 */
import { withAuth } from './auth.ts'
import * as data from './data.ts'
import type { Bindings } from './env.ts'
import { parseSongPath } from './keys.ts'
import { isMembersPath, routeMembers } from './members.ts'
import { routeSongs } from './router.ts'
import { authPathAllowed } from './tenant.ts'

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

const notFound = () => new Response('Not Found', { status: 404 })

export default {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (pathname.startsWith('/api/auth/')) {
      // churches and members are made with the CLI; the plugin's other endpoints stay closed
      if (!authPathAllowed(pathname)) return json({ error: 'not found' }, 404)
      return withAuth(env, ctx, (auth) => auth.handler(request))
    }
    if (isMembersPath(pathname)) {
      return withAuth(env, ctx, (auth, pool) =>
        routeMembers(request, { api: { getSession: (args) => auth.api.getSession(args) as never } }, pool, data.memo),
      )
    }
    if (pathname.startsWith('/songs/')) {
      const path = parseSongPath(pathname)
      if (!path) return notFound()
      return withAuth(env, ctx, (auth, pool) =>
        routeSongs(request, env, ctx, { api: { getSession: (args) => auth.api.getSession(args) as never } }, pool, data.memo),
      )
    }
    return json({ error: 'not found' }, 404)
  },
} satisfies ExportedHandler<Bindings>
