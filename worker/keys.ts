/**
 * R2 object keys. Every file of a song lives under one prefix:
 *
 *   churches/<churchId>/songs/<songId>/<rest>
 *
 * <rest> is stems/manifest.json, stems/<file>, stems/<tier>/<file>, chart.pro, analysis.json,
 * analysis/history/<time>.json. The public URL is /songs/<songId>/<rest>: the church comes from the
 * session, never from the URL. A key can only be built for ids of the right shape, and <rest> can
 * never climb out of the song's prefix.
 */
import { ID_PATTERN } from '../shared/ids.ts'

export function songPrefix(orgId: string, songId: string): string | null {
  if (!ID_PATTERN.test(orgId) || !ID_PATTERN.test(songId)) return null
  return `churches/${orgId}/songs/${songId}/`
}

const unsafe = (v: string) => v === '' || v === '.' || v === '..' || v.includes('/') || v.includes('\\') || v.includes('\0')

export function songKey(orgId: string, songId: string, rest: string[]): string | null {
  const prefix = songPrefix(orgId, songId)
  if (!prefix || rest.length === 0 || rest.some(unsafe)) return null
  return prefix + rest.join('/')
}

export type SongPath =
  | { kind: 'index' }
  | { kind: 'new' }
  | { kind: 'song'; songId: string; rest: string[]; trailingSlash: boolean }

/** "/songs/index.json", "/songs/new", "/songs/<id>", "/songs/<id>/<rest...>" (percent-decoded). Null for anything else. */
export function parseSongPath(pathname: string): SongPath | null {
  if (!pathname.startsWith('/songs/')) return null
  const raw = pathname.slice('/songs/'.length)
  if (raw === 'index.json') return { kind: 'index' }
  if (raw === 'new') return { kind: 'new' }
  const trailingSlash = raw.endsWith('/')
  const parts = raw.split('/')
  if (trailingSlash) parts.pop()
  const segments: string[] = []
  for (const part of parts) {
    let value: string
    try {
      value = decodeURIComponent(part)
    } catch {
      return null
    }
    if (unsafe(value)) return null
    segments.push(value)
  }
  const [songId, ...rest] = segments
  if (!songId || !ID_PATTERN.test(songId)) return null
  return { kind: 'song', songId, rest, trailingSlash }
}
