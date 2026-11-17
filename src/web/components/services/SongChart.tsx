import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { buttonVariants } from '@/components/ui/button'
import { songForAddress } from '../../lib/address'
import { useChart } from '../../lib/use-chart'
import ChartPages from '../ChartPages'
/**
 * A song's chart, read only, for the Songs tab: the saved chart, else one built from the analysis (shown only). `serviceKey` (this service's key for the song, when it differs)
 * moves the chords for this view only: the song's stored chart and remembered key are not touched. `lead`: controls
 * at the start of the chart's bar (the Chart / Notes switch), also shown above a note when there is no chart.
 */
export function SongChart({ songId, archived = false, title, songKey, serviceKey, lead }: { songId: string | null; archived?: boolean; title: string; songKey: string | null; serviceKey: string | null; lead?: ReactNode }) {
  const { chart, loading, error } = useChart(songId, title)
  const bar = lead ? <div className="flex justify-end pb-2">{lead}</div> : null
  const note = (child: ReactNode) => (
    <div>
      {bar}
      {child}
    </div>
  )
  if (archived) return note(<p className="px-1 py-2 text-sm text-muted-foreground">This song is archived, so its chart is not shown. Its links still work.</p>)
  if (!songId) return note(<p className="px-1 py-2 text-sm text-muted-foreground">This song is not in the song list, so it has no chart. Its links still work.</p>)
  if (loading) return note(<p role="status" className="p-2 text-sm text-muted-foreground">Loading chart…</p>)
  if (error) return note(<p role="alert" className="p-2 text-sm text-destructive">Could not load the chart ({error}).</p>)
  if (!chart) return note(<p className="px-1 py-2 text-sm text-muted-foreground">No chart for this song yet.</p>)
  return (
    <div>
      <ChartPages
        embedded
        lead={lead}
        actions={
          <Link to={`/charts?song=${encodeURIComponent(songForAddress(songId))}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            Open in Charts
          </Link>
        } key={`${songId}:${serviceKey ?? ''}`} chart={chart} songId={songId} title={title} fallbackKey={songKey ?? undefined} serviceKey={serviceKey ?? undefined} active={-1} hasCues={false} follow={false} onFollow={() => {}} playing={false} />
    </div>
  )
}
