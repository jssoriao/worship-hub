import { useEffect, useMemo, useState } from 'react'
import { parseChart, type Chart } from './chart'
import { songFile } from './api'
/** A song's ChordPro chart, read-only: `chart` is null while loading and when the song has none. */
export function useChart(songId: string | null): { chart: Chart | null; loading: boolean; error: string } {
  const [loaded, setLoaded] = useState<{ id: string; text: string | null; error: string } | null>(null)
  useEffect(() => {
    if (!songId) return
    const ctl = new AbortController()
    fetch(songFile(songId, 'chart.pro'), { signal: ctl.signal })
      .then(async (r) => {
        if (r.status === 404) return setLoaded({ id: songId, text: null, error: '' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const body = await r.text()
        setLoaded({ id: songId, text: body.trim() === '' ? null : body, error: '' })
      })
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setLoaded({ id: songId, text: null, error: e instanceof Error ? e.message : String(e) })
      })
    return () => ctl.abort()
  }, [songId])
  const current = songId && loaded?.id === songId ? loaded : null
  const text = current?.text ?? null
  const chart = useMemo(() => (text ? parseChart(text) : null), [text])
  return { chart, loading: songId !== null && current === null, error: current?.error ?? '' }
}
