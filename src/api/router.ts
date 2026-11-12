/**
 * Routes /songs/* for one request: resolve the church, check the song belongs to it, then dispatch.
 * Kept apart from index.ts (which owns the database pool) so tests can drive it with PGlite and a fake bucket.
 */
import * as data from './data.ts'
import type { Bindings } from './env.ts'
import { parseSongPath, songKey } from './keys.ts'
import { createSong, isArrangementId, listAnalysisHistory, listArrangements, patchSong, readArrangement, removeSong, saveAnalysis, saveChart, serveIndex, serveSong, writeArrangement, type Ctx } from './songs.ts'
import { allowed, requireChurch, type SessionSource } from './tenant.ts'

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const notFound = () => new Response('Not Found', { status: 404 })

export async function routeSongs(
  request: Request,
  env: Pick<Bindings, 'FILES'>,
  ctx: Pick<ExecutionContext, 'waitUntil'>,
  auth: SessionSource,
  db: data.Db,
  cache: data.Memo = data.memo,
): Promise<Response> {
  const path = parseSongPath(new URL(request.url).pathname)
  if (!path) return notFound()
  const who = await requireChurch(auth, db, request, cache)
  if ('error' in who) return who.error
  const c: Ctx = { env, db, tenant: who.tenant, extra: who.headers }
  const method = request.method

  if (path.kind === 'index') return method === 'GET' ? serveIndex(c) : json({ error: 'method not allowed' }, 405)
  if (path.kind === 'new') return method === 'POST' ? createSong(request, c) : json({ error: 'method not allowed' }, 405)

  // the song must belong to this member's church before anything else happens with its id
  if (!(await data.songBelongs(db, c.tenant.orgId, path.songId, cache))) return notFound()
  const { songId, rest } = path

  if (rest.length === 0) {
    if (method === 'PATCH') return patchSong(request, songId, c)
    if (method === 'DELETE') return removeSong(request, songId, c)
    return json({ error: 'method not allowed' }, 405)
  }
  if (rest[0] === 'arrangements') {
    if (rest.length === 1 && method === 'GET') return listArrangements(songId, c)
    const m = rest.length === 2 ? /^(.+)\.json$/.exec(rest[1]) : null
    if (m && isArrangementId(m[1])) {
      if (method === 'GET') return readArrangement(songId, m[1], c)
      if (method === 'PUT' || method === 'DELETE') return writeArrangement(request, songId, m[1], c)
    }
    return notFound()
  }
  if (rest.length === 1 && rest[0] === 'chart.pro' && method === 'PUT') return saveChart(request, songId, c)
  if (rest.length === 1 && rest[0] === 'analysis.json' && method === 'PUT') return saveAnalysis(request, songId, c)
  if (rest[0] === 'analysis' && rest[1] === 'history' && rest.length === 2) {
    return method === 'GET' ? listAnalysisHistory(songId, c) : json({ error: 'method not allowed' }, 405)
  }
  if (method !== 'GET' && method !== 'HEAD') return json({ error: 'method not allowed' }, 405)
  if (!allowed(c.tenant, { song: ['read'] })) return json({ error: 'forbidden' }, 403)
  const key = songKey(c.tenant.orgId, songId, rest)
  if (!key) return notFound()
  return serveSong(request, env, key, c.extra, ctx)
}
