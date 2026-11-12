/**
 * Practice address rules. The address (?song=<id>) is the only thing that chooses the song:
 *   no ?song          -> nothing is open
 *   ?song=<id>        -> that song, when the active church has it
 *   unknown id        -> a message and a clean /practice (once the church's list has loaded)
 */
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
