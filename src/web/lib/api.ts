/**
 * The typed API client (Hono RPC, `hono/client`). Paths, bodies and answers come from the Worker's
 * routes (src/api/app.ts), so a change there that the app does not follow fails `pnpm build`.
 *
 * Audio, manifests and other song files are not fetched through it: they are plain URLs (`songFile`)
 * so the audio engine can stream them with Range requests and the offline cache can keep them.
 */
import { DetailedError, hc, parseResponse, type ClientResponse } from 'hono/client'
import type { AppType } from '../../api/app.ts'
const origin = typeof location === 'undefined' ? 'http://localhost' : location.origin
// answers are always fresh (the API says no-store too); a call that passes its own `init` replaces this
const client = hc<AppType>(origin, { init: { cache: 'no-store' } })
/** /songs/*: the active church's songs. */
export const songsApi = client.songs
/** /api/church/members: the active church's people. */
export const membersApi = client.api.church.members
/** /api/church/links: the active church's join links. */
export const linksApi = client.api.church.links
/** /api/church/services: the active church's services and setlists. */
export const servicesApi = client.api.church.services

/** /api/church/ai: the church's Music.AI credits. */
export const aiApi = client.api.church.ai
/** /api/join/<token>: joining a church through a link. */
export const joinApi = client.api.join
/** An answer that was not ok. `message` is the server's `{ error }` (written for people) unless replaced. */
export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}
/**
 * The body of an ok answer, typed from the route; throws ApiError otherwise. `messages` replaces the
 * server's message for given statuses (for example 403 -> what this person may not do).
 */
export function call<T extends ClientResponse<unknown>>(request: Promise<T>, messages: Partial<Record<number, string>> = {}): ReturnType<typeof parseResponse<T>> {
  return parseResponse(request).catch((error: unknown) => {
    if (!(error instanceof DetailedError)) throw error
    const status = error.statusCode ?? 0
    const data = (error.detail as { data?: unknown } | undefined)?.data
    const server = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : ''
    throw new ApiError(messages[status] ?? (server || `Something went wrong (HTTP ${status}). Try again.`), status)
  })
}
/** A song file's address: /songs/<id>/<path...> (each part encoded). */
export const songFile = (songId: string, ...path: string[]) => `/songs/${[songId, ...path].map(encodeURIComponent).join('/')}`
