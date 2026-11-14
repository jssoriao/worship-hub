import { useChart } from '../../lib/use-chart'
import ChartPages from '../ChartPages'
/**
 * A song's chart, read only, for the Songs tab. `serviceKey` (this service's key for the song, when it differs)
 * moves the chords for this view only: the song's stored chart and remembered key are not touched.
 */
export function SongChart({ songId, archived = false, title, songKey, serviceKey }: { songId: string | null; archived?: boolean; title: string; songKey: string | null; serviceKey: string | null }) {
  const { chart, loading, error } = useChart(songId)
  if (archived) return <p className="px-1 py-2 text-sm text-muted-foreground">This song is archived, so its chart is not shown. Its links still work.</p>
  if (!songId) return <p className="px-1 py-2 text-sm text-muted-foreground">This song is not in the song list, so it has no chart. Its links still work.</p>
  if (loading) return <p role="status" className="p-2 text-sm text-muted-foreground">Loading chart…</p>
  if (error) return <p role="alert" className="p-2 text-sm text-destructive">Could not load the chart ({error}).</p>
  if (!chart) return <p className="px-1 py-2 text-sm text-muted-foreground">No chart for this song yet.</p>
  return (
    <div className="grid gap-1.5">
      {serviceKey && <p className="text-xs text-muted-foreground">Shown in {serviceKey} for this service. The song's own chart is unchanged.</p>}
      <ChartPages key={`${songId}:${serviceKey ?? ''}`} chart={chart} songId={songId} title={title} fallbackKey={songKey ?? undefined} serviceKey={serviceKey ?? undefined} active={-1} hasCues={false} follow={false} onFollow={() => {}} playing={false} />
    </div>
  )
}
