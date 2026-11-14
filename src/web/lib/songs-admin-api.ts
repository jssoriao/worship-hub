/** The admin Songs page's calls: every song with what it has, archived ones too; archive and restore. */
import { call, songsApi } from './api'

export const listSongsAdmin = () => call(songsApi['admin.json'].$get())
export type AdminSong = Awaited<ReturnType<typeof listSongsAdmin>>[number]
export const archiveSong = (id: string) => call(songsApi[':songId'].archive.$post({ param: { songId: id } }))
export const restoreSong = (id: string) => call(songsApi[':songId'].restore.$post({ param: { songId: id } }))
