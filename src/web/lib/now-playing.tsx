import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { NowPlayingContext, type NowPlaying, type Transport } from './now-playing-context.ts'
export function NowPlayingProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<NowPlaying>({ title: '', songId: '', churchId: '', playing: false })
  const transport = useRef<Transport | null>(null)
  // only change when something actually differs, so reporting the same thing again re-renders nothing
  const set = useCallback((next: NowPlaying) => {
    setState((prev) => (prev.title === next.title && prev.songId === next.songId && prev.churchId === next.churchId && prev.playing === next.playing ? prev : next))
  }, [])
  const setTransport = useCallback((t: Transport | null) => {
    transport.current = t
  }, [])
  const getTransport = useCallback(() => transport.current, [])
  const value = useMemo(() => ({ ...state, set, setTransport, getTransport }), [state, set, setTransport, getTransport])
  return <NowPlayingContext.Provider value={value}>{children}</NowPlayingContext.Provider>
}
