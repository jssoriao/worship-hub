/**
 * Practice address rules. The address (?song=<id>) is the only thing that chooses the song:
 *   no ?song          -> nothing is open
 *   ?song=<id>        -> that song, when the active church has it
 *   unknown id        -> a message and a clean /practice (once the church's list has loaded)
 *
 * The address shows the song id without its prefix (`?song=mc3e...` for `song_mc3e...`); the full id
 * (with the prefix) is accepted too.
 */
import { bare, fromBare } from '../../shared/ids'

/** The song named in the address, as a full id. Anything else comes back as is, so it shows as unknown. */
export const songFromAddress = (value: string | null): string => fromBare('song', value) ?? value ?? ''

/** How a song id is written in the address. */
export const songForAddress = (id: string): string => bare(id)

/** The Practice page with this song open. */
export const practicePath = (id: string): string => `/practice?song=${encodeURIComponent(songForAddress(id))}`

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
