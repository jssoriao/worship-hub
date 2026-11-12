/**
 * Serves one church's private R2 song files under /songs/<songId>/..., using the same URL layout as
 * src/cli/lib/song-files.ts:
 *
 *   /songs/<id>/stems/manifest.json    -> { title, stems: [...] }
 *   /songs/<id>/stems/<group>/<file>   -> audio bytes (Range supported)
 *
 * The object lives at churches/<churchId>/songs/<songId>/<same path> (see keys.ts). The caller has
 * checked that the signed-in member's active church owns the song (data.songBelongs) before anything here runs.
 */
import { allowed, type Tenant } from './tenant.ts'
import * as data from './data.ts'
import type { Db } from './data.ts'
import type { Bindings } from './env.ts'
import { songKey, songPrefix } from './keys.ts'

/**
 * Audio asked for with a content fingerprint (?v=<hash of its bytes>) never changes at that
 * address, so the browser may keep it for a year. The address of a file changes when its content
 * does. `private` keeps shared caches (proxies) from storing what only members may have.
 */
const FINGERPRINT = /^[0-9a-f]{8,64}$/
const IMMUTABLE = 'private, max-age=31536000, immutable'
/** What the edge cache keeps a copy for. It is never sent to a client (those get IMMUTABLE). */
const EDGE_TTL = 'public, max-age=2592000'
const EDGE_MAX_BYTES = 100 * 1024 * 1024

function objectHeaders(object: R2Object, extra: Headers, fingerprinted = false): Headers {
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('ETag', object.httpEtag)
  headers.set('Accept-Ranges', 'bytes')
  headers.set('X-Content-Type-Options', 'nosniff')
  // the library listing must reflect uploads right away; other audio can be reused briefly
  headers.set('Cache-Control', object.key.endsWith('.json') || object.key.endsWith('.pro') ? 'private, no-cache' : fingerprinted ? IMMUTABLE : 'private, max-age=3600')
  // refreshed session cookie from the auth check, if there is one
  for (const cookie of extra.getSetCookie()) headers.append('Set-Cookie', cookie)
  return headers
}

/** Content-Range value and byte length for a ranged read. */
function describeRange(object: R2ObjectBody): { header: string; length: number } | null {
  if (!object.range) return null
  // the runtime object may carry all three keys, with the unused ones undefined
  const { offset: rawOffset, length: rawLength, suffix } = object.range as { offset?: number; length?: number; suffix?: number }
  let offset: number
  let length: number
  if (typeof suffix === 'number') {
    length = Math.min(suffix, object.size)
    offset = object.size - length
  } else {
    offset = rawOffset ?? 0
    length = Math.min(rawLength ?? object.size - offset, object.size - offset)
  }
  return { header: `bytes ${offset}-${offset + length - 1}/${object.size}`, length }
}

const text = (body: string, status: number, headers?: HeadersInit) => new Response(body, { status, headers })

/**
 * Serves a file of the library. The caller has checked the session already (see index.ts), which
 * is why a copy kept in the edge cache can be returned here: nobody reaches this point without it.
 *
 * `extra` carries headers from the auth check (a refreshed session cookie) to add to the response.
 * `ctx` lets the edge cache be filled after the response has been sent.
 */
export async function serveSong(
  request: Request,
  env: Pick<Bindings, 'FILES'>,
  key: string,
  extra: Headers,
  ctx?: Pick<ExecutionContext, 'waitUntil'>,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return text('Method Not Allowed', 405, { Allow: 'GET, HEAD' })
  }
  const url = new URL(request.url)
  const version = url.searchParams.get('v') ?? ''
  const fingerprinted = FINGERPRINT.test(version)

  if (request.method === 'HEAD') {
    const head = await env.FILES.head(key)
    if (!head) return text('Not Found', 404)
    const headers = objectHeaders(head, extra, fingerprinted)
    headers.set('Content-Length', String(head.size))
    return new Response(null, { headers })
  }

  // Whole fingerprinted files go through the edge cache: a copy near the listener saves the trip to
  // R2, and the fingerprint in the key means the copy can never be out of date. Ranges and
  // conditional requests are rare and cheap, so they go straight to R2.
  const cache = typeof caches === 'undefined' ? undefined : caches.default
  const useEdge =
    !!cache && fingerprinted && !request.headers.has('Range') && !request.headers.has('If-None-Match') && !request.headers.has('If-Modified-Since')
  const edgeKey = useEdge ? new Request(`${url.origin}/__edge/${key}?v=${version}`) : undefined
  if (cache && edgeKey) {
    const hit = await cache.match(edgeKey).catch(() => undefined)
    if (hit?.body) {
      const headers = new Headers(hit.headers)
      headers.set('Cache-Control', IMMUTABLE)
      headers.set('Accept-Ranges', 'bytes')
      headers.set('X-Content-Type-Options', 'nosniff')
      headers.set('X-Edge-Cache', 'HIT')
      for (const cookie of extra.getSetCookie()) headers.append('Set-Cookie', cookie)
      return new Response(hit.body, { headers })
    }
  }

  let object: R2Object | R2ObjectBody | null
  try {
    object = await env.FILES.get(key, { range: request.headers, onlyIf: request.headers })
  } catch {
    // malformed or unsatisfiable Range header
    return text('Range Not Satisfiable', 416)
  }
  if (!object) return text('Not Found', 404)

  const headers = objectHeaders(object, extra, fingerprinted)
  // no body means a conditional request (If-None-Match) matched
  if (!('body' in object)) return new Response(null, { status: 304, headers })

  if (cache && edgeKey && ctx && object.size <= EDGE_MAX_BYTES && !request.headers.has('Range')) {
    // one stream for the listener, one for the cache
    const [toListener, toCache] = object.body.tee()
    const stored = new Headers()
    object.writeHttpMetadata(stored)
    stored.set('ETag', object.httpEtag)
    stored.set('Content-Length', String(object.size))
    stored.set('Cache-Control', EDGE_TTL)
    ctx.waitUntil(cache.put(edgeKey, new Response(toCache, { headers: stored })).catch(() => {}))
    headers.set('Content-Length', String(object.size))
    headers.set('X-Edge-Cache', 'MISS')
    return new Response(toListener, { headers })
  }

  // the runtime reports a range even for whole-object reads, so only honour it when asked
  const ranged = request.headers.has('Range') ? describeRange(object) : null
  if (ranged) {
    headers.set('Content-Range', ranged.header)
    headers.set('Content-Length', String(ranged.length))
    return new Response(object.body, { status: 206, headers })
  }
  headers.set('Content-Length', String(object.size))
  return new Response(object.body, { headers })
}

// ---------------------------------------------------------------- everything below is tenant scoped

export interface Ctx {
  env: Pick<Bindings, 'FILES'>
  db: Db
  tenant: Tenant
  /** headers from the auth check (a refreshed session cookie) to add to the response */
  extra: Headers
}

const withCookies = (init: Headers, extra: Headers) => {
  for (const cookie of extra.getSetCookie()) init.append('Set-Cookie', cookie)
  return init
}
const jsonResponse = (body: unknown, status: number, extra: Headers) =>
  new Response(JSON.stringify(body), { status, headers: withCookies(new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }), extra) })
const empty = (status: number, extra: Headers) => new Response(null, { status, headers: withCookies(new Headers({ 'Cache-Control': 'no-store' }), extra) })
const forbidden = () => text('Forbidden', 403)

/** Writes only come from the app's own origin. */
const crossOrigin = (request: Request) => {
  const origin = request.headers.get('Origin')
  return !!origin && origin !== new URL(request.url).origin
}

/** GET /songs/index.json: this church's songs, from the database. */
export async function serveIndex({ db, tenant, extra }: Ctx): Promise<Response> {
  if (!allowed(tenant, { song: ['read'] })) return forbidden()
  const list = await data.listSongs(db, tenant.orgId)
  const headers = withCookies(new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'private, no-cache' }), extra)
  return new Response(JSON.stringify(list), { headers })
}

const TITLE_MAX = 120
const cleanText = (value: unknown, max: number): string | null | undefined => {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const v = value.trim().slice(0, max)
  return v === '' ? null : v
}

/** POST /songs/new {title}: adds a song (no stems yet), so it can have a chart. */
export async function createSong(request: Request, { db, tenant, extra }: Ctx): Promise<Response> {
  if (crossOrigin(request)) return forbidden()
  if (!allowed(tenant, { song: ['create'] })) return forbidden()
  let title: string | null | undefined
  try {
    title = cleanText(((await request.json()) as { title?: unknown }).title, TITLE_MAX)
  } catch {
    return text('Bad Request', 400)
  }
  if (!title) return text('Give the song a title', 400)
  const song = await data.createSong(db, tenant.orgId, tenant.user.id, title)
  if (song === 'exists') return text('A song with this name exists already', 409)
  return jsonResponse(song, 201, extra)
}

/** PATCH /songs/<id> {title?, artist?, key?, bpm?, meter?}: song details. */
export async function patchSong(request: Request, songId: string, { db, tenant, extra }: Ctx): Promise<Response> {
  if (crossOrigin(request)) return forbidden()
  if (!allowed(tenant, { content: ['edit'] })) return forbidden()
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return text('Bad Request', 400)
  }
  const patch: data.SongPatch = {}
  if ('title' in body) {
    const title = cleanText(body.title, TITLE_MAX)
    if (!title) return text('A song needs a title', 400)
    patch.title = title
  }
  if ('artist' in body) {
    const v = cleanText(body.artist, TITLE_MAX)
    if (v === undefined) return text('Bad Request', 400)
    patch.artist = v
  }
  if ('key' in body) {
    const v = cleanText(body.key, 12)
    if (v === undefined) return text('Bad Request', 400)
    patch.key = v
  }
  if ('bpm' in body) {
    if (body.bpm !== null && !(typeof body.bpm === 'number' && body.bpm > 0 && body.bpm < 1000)) return text('Bad Request', 400)
    patch.bpm = body.bpm as number | null
  }
  if ('meter' in body) {
    if (body.meter !== null && !(Number.isInteger(body.meter) && (body.meter as number) > 0 && (body.meter as number) < 33)) return text('Bad Request', 400)
    patch.meter = body.meter as number | null
  }
  const song = await data.updateSong(db, tenant.orgId, songId, patch)
  if (song === 'exists') return text('A song with this name exists already', 409)
  if (!song) return text('Not Found', 404)
  return jsonResponse(song, 200, extra)
}

/** DELETE /songs/<id>: the row (and its arrangements), then every file of the song. */
export async function removeSong(request: Request, songId: string, { env, db, tenant, extra }: Ctx): Promise<Response> {
  if (crossOrigin(request)) return forbidden()
  if (!allowed(tenant, { song: ['delete'] })) return forbidden()
  const prefix = songPrefix(tenant.orgId, songId)
  if (!prefix || !(await data.deleteSong(db, tenant.orgId, songId))) return text('Not Found', 404)
  let cursor: string | undefined
  do {
    const page = await env.FILES.list({ prefix, cursor, limit: 1000 })
    if (page.objects.length > 0) await env.FILES.delete(page.objects.map((o) => o.key))
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  return empty(204, extra)
}

/**
 * PUT /songs/<id>/chart.pro: saves the song's chart (content:edit).
 */
export async function saveChart(request: Request, songId: string, { env, tenant, extra }: Ctx): Promise<Response> {
  if (crossOrigin(request)) return forbidden()
  if (!allowed(tenant, { content: ['edit'] })) return forbidden()
  const key = songKey(tenant.orgId, songId, ['chart.pro'])
  if (!key) return text('Not Found', 404)
  const body = await request.text()
  if (new TextEncoder().encode(body).length > CHART_MAX_BYTES) return text('Chart too large', 413)
  await env.FILES.put(key, body, { httpMetadata: { contentType: 'text/plain; charset=utf-8' } })
  return empty(204, extra)
}
const CHART_MAX_BYTES = 200 * 1024

// ---------------------------------------------------------------- arrangements

const ARRANGEMENT_ID = /^[A-Za-z0-9_-]{6,32}$/
const ARRANGEMENT_MAX_BYTES = 100 * 1024
export const isArrangementId = (id: string) => ARRANGEMENT_ID.test(id)

/** GET /songs/<id>/arrangements/: [{ id, name, owner, ownerName, updated }], newest first. */
export async function listArrangements(songId: string, { db, tenant, extra }: Ctx): Promise<Response> {
  return jsonResponse(await data.listArrangements(db, tenant.orgId, songId), 200, extra)
}

function stored(row: data.ArrangementRow, songId: string) {
  return { ...row.data, id: row.id, song: songId, name: row.name, owner: row.owner ?? '', updated: row.updated }
}

/** GET /songs/<id>/arrangements/<aid>.json */
export async function readArrangement(songId: string, id: string, { db, tenant, extra }: Ctx): Promise<Response> {
  const row = await data.getArrangement(db, tenant.orgId, songId, id)
  return row ? jsonResponse(stored(row, songId), 200, extra) : text('Not Found', 404)
}

/**
 * PUT/DELETE /songs/<id>/arrangements/<aid>.json. Any member may make one (arrangement:create); once
 * made, only its owner or someone who may manage arrangements changes it. The owner is kept.
 */
export async function writeArrangement(request: Request, songId: string, id: string, { db, tenant, extra }: Ctx): Promise<Response> {
  if (crossOrigin(request)) return forbidden()
  const existing = await data.getArrangement(db, tenant.orgId, songId, id)
  if (existing && existing.owner !== tenant.user.id && !allowed(tenant, { arrangement: ['manage'] })) {
    return text('Only its owner or an editor can change this arrangement', 403)
  }
  if (request.method === 'DELETE') {
    if (!existing) return text('Not Found', 404)
    await data.deleteArrangement(db, tenant.orgId, songId, id)
    return jsonResponse({ ok: true }, 200, extra)
  }
  if (!existing && !allowed(tenant, { arrangement: ['create'] })) return forbidden()
  const body = await request.text()
  if (new TextEncoder().encode(body).length > ARRANGEMENT_MAX_BYTES) return text('Arrangement too large', 413)
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(body) as Record<string, unknown>
  } catch {
    return text('Bad Request', 400)
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.sections) || !Array.isArray(parsed.blocks)) return text('Bad Request', 400)
  const name = (typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : 'Arrangement').slice(0, 80)
  // what lives in its own column is not repeated in the document
  const { id: _id, song: _song, owner: _owner, updated: _updated, name: _name, ...rest } = parsed
  const row = await data.saveArrangement(db, tenant.orgId, songId, id, tenant.user.id, name, rest)
  if (!row) return text('Not Found', 404)
  return jsonResponse(stored(row, songId), 200, extra)
}

// ---------------------------------------------------------------- analysis (chords, sections, lyrics)

const ANALYSIS_MAX_BYTES = 1024 * 1024

/**
 * PUT /songs/<id>/analysis.json: saves an edited analysis (chords, sections, lyrics). The copy it
 * replaces is kept under analysis/history/<time>.json in the song's folder, so any version can be brought back.
 */
export async function saveAnalysis(request: Request, songId: string, { env, tenant, extra }: Ctx): Promise<Response> {
  if (crossOrigin(request)) return forbidden()
  if (!allowed(tenant, { content: ['edit'] })) return forbidden()
  const key = songKey(tenant.orgId, songId, ['analysis.json'])
  if (!key) return text('Not Found', 404)
  const current = await env.FILES.get(key)
  if (!current) return text('Not Found', 404) // only songs that have been analysed
  const body = await request.text()
  if (new TextEncoder().encode(body).length > ANALYSIS_MAX_BYTES) return text('Too large', 413)
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(body) as Record<string, unknown>
  } catch {
    return text('Bad Request', 400)
  }
  if (parsed?.v !== 1 || !Array.isArray(parsed.beats) || !Array.isArray(parsed.chords) || !Array.isArray(parsed.sections) || !Array.isArray(parsed.lines)) {
    return text('Bad Request', 400)
  }
  const now = new Date().toISOString()
  const previous = current.customMetadata ?? {}
  const historyKey = songKey(tenant.orgId, songId, ['analysis', 'history', `${now.replace(/[:.]/g, '-')}.json`])
  if (!historyKey) return text('Not Found', 404)
  await env.FILES.put(historyKey, await current.text(), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { savedAt: previous.updatedAt ?? current.uploaded.toISOString(), savedBy: previous.updatedBy ?? 'analysis' },
  })
  const editor = (tenant.user.name || tenant.user.email || tenant.user.id).slice(0, 120)
  await env.FILES.put(key, JSON.stringify(parsed), {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { updatedAt: now, updatedBy: editor },
  })
  return jsonResponse({ ok: true, updatedAt: now }, 200, extra)
}

/** "2026-11-12T01-45-14-726Z.json" -> ISO time, or undefined */
function timeFromFile(file: string): string | undefined {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3}Z)\.json$/.exec(file)
  return m ? `${m[1]}:${m[2]}:${m[3]}.${m[4]}` : undefined
}

/** GET /songs/<id>/analysis/history/: earlier versions, newest first: [{ file, savedAt, savedBy }]. */
export async function listAnalysisHistory(songId: string, { env, tenant, extra }: Ctx): Promise<Response> {
  const dir = songKey(tenant.orgId, songId, ['analysis', 'history'])
  if (!dir) return text('Not Found', 404)
  const prefix = `${dir}/`
  const out: { file: string; savedAt: string; savedBy: string }[] = []
  let cursor: string | undefined
  do {
    const page = await env.FILES.list({ prefix, cursor, include: ['customMetadata'] })
    for (const o of page.objects) {
      const file = o.key.slice(prefix.length)
      // copied objects can lose their custom metadata (wrangler cannot set it): the file name is the time it was replaced
      out.push({ file, savedAt: o.customMetadata?.savedAt ?? timeFromFile(file) ?? o.uploaded.toISOString(), savedBy: o.customMetadata?.savedBy ?? '' })
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)
  out.sort((a, b) => b.file.localeCompare(a.file))
  return jsonResponse(out, 200, extra)
}
