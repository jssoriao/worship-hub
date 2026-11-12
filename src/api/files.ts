/**
 * Serves one file of a church's private R2 song folder, using the same URL layout as
 * src/cli/lib/song-files.ts:
 *
 *   /songs/<id>/stems/manifest.json    -> { title, stems: [...] }
 *   /songs/<id>/stems/<group>/<file>   -> audio bytes (Range supported)
 *
 * The object lives at churches/<churchId>/songs/<songId>/<same path> (see keys.ts). The route has
 * checked the session and that the active church owns the song before anything here runs, which is
 * why a copy kept in the edge cache can be returned: nobody reaches this point without them.
 */
import type { Bindings } from './env.ts'
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
function objectHeaders(object: R2Object, fingerprinted = false): Headers {
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('ETag', object.httpEtag)
  headers.set('Accept-Ranges', 'bytes')
  headers.set('X-Content-Type-Options', 'nosniff')
  // the library listing must reflect uploads right away; other audio can be reused briefly
  headers.set('Cache-Control', object.key.endsWith('.json') || object.key.endsWith('.pro') ? 'private, no-cache' : fingerprinted ? IMMUTABLE : 'private, max-age=3600')
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
 * GET or HEAD of the object at `key`: Range, conditional requests (304) and, for whole fingerprinted
 * files, the edge cache. `ctx` lets the edge cache be filled after the response has been sent.
 */
export async function serveFile(request: Request, env: Pick<Bindings, 'FILES'>, key: string, ctx?: Pick<ExecutionContext, 'waitUntil'>): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return text('Method Not Allowed', 405, { Allow: 'GET, HEAD' })
  }
  const url = new URL(request.url)
  const version = url.searchParams.get('v') ?? ''
  const fingerprinted = FINGERPRINT.test(version)
  if (request.method === 'HEAD') {
    const head = await env.FILES.head(key)
    if (!head) return text('Not Found', 404)
    const headers = objectHeaders(head, fingerprinted)
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
  const headers = objectHeaders(object, fingerprinted)
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
