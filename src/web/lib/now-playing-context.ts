import { createContext, useContext } from 'react'
import { practicePath } from './address'
/** What the Practice page is playing, shared so the nav bar and the charts can follow it. */
export interface NowPlaying {
  title: string
  /** library song id, '' when the song came from a zip */
  songId: string
  /** the church the song belongs to, so other pages only offer to resume a song of the church that is active */
  churchId: string
  playing: boolean
}
/** Lets other pages read the playhead and move it. Set by the Practice page. */
export interface Transport {
  position: () => number
  seek: (seconds: number) => Promise<void>
  /** stops Practice (when another page starts playing) */
  pause: () => void
}
export interface NowPlayingValue extends NowPlaying {
  set: (value: NowPlaying) => void
  /** the Practice page registers itself here (null to unregister) */
  setTransport: (transport: Transport | null) => void
  getTransport: () => Transport | null
}
export const NowPlayingContext = createContext<NowPlayingValue>({
  title: '',
  songId: '',
  churchId: '',
  playing: false,
  set: () => {},
  setTransport: () => {},
  getTransport: () => null,
})
export function useNowPlaying() {
  return useContext(NowPlayingContext)
}

/** The Practice address for the open song, only when it belongs to the active church. */
export function practiceLink(now: Pick<NowPlaying, 'songId' | 'churchId'>, activeChurchId: string): string {
  return now.songId && now.churchId === activeChurchId ? practicePath(now.songId) : '/practice'
}
