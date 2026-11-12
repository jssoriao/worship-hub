/**
 * Where the song library lives.
 * - dev: defaults to `/songs`, served from ./songs by the dev plugin
 * - prod: `/songs` (see .env.production), served from R2 by the Cloudflare Worker; empty = zip-only
 */
const configured = (import.meta.env.VITE_SONGS_BASE_URL as string | undefined) ?? (import.meta.env.DEV ? '/songs' : '')

export const SONGS_BASE_URL = configured.replace(/\/+$/, '')

/**
 * Production always requires a signed-in member. `pnpm dev` skips the login so the dev song server
 * works on its own; set VITE_REQUIRE_AUTH=1 (with `wrangler dev` proxied) to exercise the login screen.
 */
export const AUTH_REQUIRED = !import.meta.env.DEV || import.meta.env.VITE_REQUIRE_AUTH === '1'
