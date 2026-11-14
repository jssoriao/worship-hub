import { useEffect, useMemo, useState } from 'react'
import { fetchAnalysis } from './analysis'
import { songFile } from './api'
import { parseChart, type Chart } from './chart'
import { chartFromAnalysis } from './chart-from-analysis'
type Loaded = { id: string; text: string | null; fromAnalysis: boolean; error: string }
/**
 * A song's chart, read-only. Its saved ChordPro chart when it has one; otherwise one built in the browser
 * from its analysis (chords, lyrics, sections), which is shown only and never saved (`fromAnalysis`).
 * `chart` is null while loading and when the song has neither.
 */
export function useChart(songId: string | null, title = ''): { chart: Chart | null; fromAnalysis: boolean; loading: boolean; error: string } {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  useEffect(() => {
    if (!songId) return
    const ctl = new AbortController()
    const load = async (): Promise<Loaded> => {
      const r = await fetch(songFile(songId, 'chart.pro'), { signal: ctl.signal })
      if (r.ok) {
        const body = await r.text()
        if (body.trim() !== '') return { id: songId, text: body, fromAnalysis: false, error: '' }
      } else if (r.status !== 404) throw new Error(`HTTP ${r.status}`)
      const analysis = await fetchAnalysis(songId)
      if (!analysis || analysis.lines.length + analysis.chords.length === 0) return { id: songId, text: null, fromAnalysis: false, error: '' }
      return { id: songId, text: chartFromAnalysis(analysis, { title }), fromAnalysis: true, error: '' }
    }
    load().then(
      (l) => !ctl.signal.aborted && setLoaded(l),
      (e: unknown) => !ctl.signal.aborted && setLoaded({ id: songId, text: null, fromAnalysis: false, error: e instanceof Error ? e.message : String(e) }),
    )
    return () => ctl.abort()
  }, [songId, title])
  const current = songId && loaded?.id === songId ? loaded : null
  const text = current?.text ?? null
  const chart = useMemo(() => (text ? parseChart(text) : null), [text])
  return { chart, fromAnalysis: current?.fromAnalysis ?? false, loading: songId !== null && current === null, error: current?.error ?? '' }
}
