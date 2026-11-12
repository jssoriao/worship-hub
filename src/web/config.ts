/**
 * Where the song library lives.
 * - dev: defaults to `/songs`, answered by the local Worker (`pnpm dev:api`) through the Vite proxy
 * - prod: `/songs` (see .env.production), served from R2 by the Cloudflare Worker; empty = zip-only
 */
const configured = (import.meta.env.VITE_SONGS_BASE_URL as string | undefined) ?? (import.meta.env.DEV ? '/songs' : '')

export const SONGS_BASE_URL = configured.replace(/\/+$/, '')

