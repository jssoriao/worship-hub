/**
 * Practice address rules. The address (?song=<id>) is the only thing that chooses the song:
 *   no ?song          -> nothing is open
 *   ?song=<id>        -> that song, when the active church has it
 *   unknown id        -> a message and a clean /practice (once the church's list has loaded)
 *
 * A service that plays a song in another key adds `&key=<semitones from the recording>` (-6..6): Practice
 * opens in that key and then drops it from the address (the key stays on this device like any other change).
 *
 * The address shows the song id without its prefix (`?song=mc3e...` for `song_mc3e...`); the full id
 * (with the prefix) is accepted too.
 */
import { bare, fromBare } from '../../shared/ids'
import { parseKey, semitonesBetween } from './chords'
import { MAX_KEY_SHIFT } from './key-shift'

/** The song named in the address, as a full id. Anything else comes back as is, so it shows as unknown. */
export const songFromAddress = (value: string | null): string => fromBare('song', value) ?? value ?? ''

/** How a song id is written in the address. */
export const songForAddress = (id: string): string => bare(id)

/** The Practice page with this song open, in a key `shift` semitones from the recording when a service asks for one. */
export const practicePath = (id: string, shift?: number): string => `/practice?song=${encodeURIComponent(songForAddress(id))}${shift === undefined ? '' : `&key=${shift}`}`
/** The key the address asks for, as semitones from the recording (-6..6), or null when it asks for none or nonsense. */
export function keyFromAddress(value: string | null): number | null {
  if (value === null || !/^[+-]?\d{1,2}$/.test(value.trim())) return null
  const n = Number(value)
  const wrapped = n > MAX_KEY_SHIFT ? n - 12 : n < -MAX_KEY_SHIFT ? n + 12 : n
  return Math.max(-MAX_KEY_SHIFT, Math.min(MAX_KEY_SHIFT, wrapped))
}
/**
 * How far a service's key for a song is from the recording, in semitones: what Practice has to shift to play it
 * in that key. undefined when the service sets no key, or either key cannot be read (the song then opens as the
 * device last had it).
 */
export function serviceKeyShift(songKey: string | null | undefined, serviceKey: string | null | undefined): number | undefined {
  const from = songKey ? parseKey(songKey) : null
  const to = serviceKey?.trim() ? parseKey(serviceKey) : null
  return from && to ? semitonesBetween(from, to) : undefined
}

export type SongParam =
  | { kind: 'none' }
  | { kind: 'waiting' }
  | { kind: 'open'; id: string }
  | { kind: 'unknown'; id: string }

/** `library` is null until the church's song list has loaded. */
export function resolveSongParam(param: string, library: { id: string }[] | null): SongParam {
  if (!param) return { kind: 'none' }
  if (library === null) return { kind: 'waiting' }
  return library.some((s) => s.id === param) ? { kind: 'open', id: param } : { kind: 'unknown', id: param }
}
