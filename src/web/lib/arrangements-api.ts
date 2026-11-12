/** Saving and loading arrangements, through the typed API client. */
import { call, songsApi } from './api'
import { checkArrangement, type Arrangement } from './arrangement'
const arrangements = songsApi[':songId'].arrangements
const one = arrangements[':arrangementId']
/** 403 on a write means someone else's arrangement */
const notYours = { 403: 'only its owner or an editor can change it' }
export const listArrangements = (song: string) => call(arrangements.$get({ param: { songId: song } }))
export type ArrangementInfo = Awaited<ReturnType<typeof listArrangements>>[number]
export async function loadArrangement(song: string, id: string): Promise<Arrangement> {
  const a = checkArrangement(await call(one.$get({ param: { songId: song, arrangementId: id } })))
  if (!a) throw new Error('This arrangement could not be read.')
  return a
}
/** Saves and returns the stored copy (with its owner and time). */
export async function saveArrangement(a: Arrangement): Promise<Arrangement> {
  const stored = await call(one.$put({ param: { songId: a.song, arrangementId: a.id }, json: { ...a } }), notYours)
  return checkArrangement(stored) ?? a
}
export async function deleteArrangement(song: string, id: string): Promise<void> {
  await call(one.$delete({ param: { songId: song, arrangementId: id } }), notYours)
}
