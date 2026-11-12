import { useState, type ReactNode } from 'react'

export type PlayerView = 'stems' | 'lyrics' | 'chords' | 'shapes'

const VIEWS: [PlayerView, string][] = [
  ['stems', 'Stems'],
  ['lyrics', 'Lyrics'],
  ['chords', 'Chords'],
  ['shapes', 'Shapes'],
]

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

interface Props {
  title: string
  /** key, tempo, metre, stems and what is happening (buffering, downloading) */
  facts: string
  playing: boolean
  buffering: boolean
  position: number
  duration: number
  onToggle: () => void
  onSeek: (seconds: number) => void
  /** "Bar 12 of 170", when the song has beats */
  bar?: string
  /** the views, when the song has been analysed */
  view?: PlayerView
  onView?: (v: PlayerView) => void
  /** the right-hand controls: tempo and key, the click, settings, edit */
  tools?: ReactNode
}

const SKIP = 5

/**
 * The play bar, docked to the bottom: the song on the left, playback in the middle,
 * tools on the right, and the views floating just above it. On phones it takes two rows.
 */
export function TransportBar({ title, facts, playing, buffering, position, duration, onToggle, onSeek, bar, view, onView, tools }: Props) {
  // while the seek bar is dragged it shows where you are going, and seeks when you let go
  const [drag, setDrag] = useState<number | null>(null)
  const shownPos = drag ?? position
  const iconBtn = 'flex size-9 items-center justify-center rounded-lg text-slate-300 outline-none hover:bg-accent hover:text-white focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <div className="fixed inset-x-0 bottom-0 z-20">
      {view && onView && (
        <nav aria-label="Views" className="pointer-events-none mb-3 flex justify-center">
          <div className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-input bg-card/95 p-1 shadow-xl shadow-black/50 backdrop-blur">
            {VIEWS.map(([v, label]) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => onView(v)}
                className={`rounded-xl px-3 py-1.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-4 ${view === v ? 'bg-teal-700 text-white' : 'text-slate-300 hover:bg-accent'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </nav>
      )}

      <div role="region" aria-label="Playback" className="border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 md:grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          {/* the song */}
          <div className="order-1 min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground" title={title}>
              {title}
            </p>
            <p className="truncate text-xs text-muted-foreground" title={facts}>
              {facts}
            </p>
          </div>

          {/* playback */}
          <div className="order-3 flex w-full flex-col items-center md:order-2 md:w-[26rem]">
            <div className="flex items-center gap-1">
              <button type="button" aria-label={`Back ${SKIP} seconds`} title={`Back ${SKIP} seconds`} onClick={() => onSeek(Math.max(0, position - SKIP))} className={iconBtn}>
                <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="currentColor">
                  <path d="M9 5v10L2 10zM17 5v10l-7-5z" />
                </svg>
              </button>
              <button
                type="button"
                aria-label={playing ? 'Pause' : 'Play'}
                onClick={onToggle}
                className="flex size-10 items-center justify-center rounded-full bg-primary text-white outline-none hover:bg-teal-500 focus-visible:ring-2 focus-visible:ring-teal-300"
              >
                {playing && buffering ? (
                  <span aria-hidden="true" className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                ) : playing ? (
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="currentColor">
                    <path d="M5 4h3.5v12H5zM11.5 4H15v12h-3.5z" />
                  </svg>
                ) : (
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="ml-0.5 size-4" fill="currentColor">
                    <path d="M5 3.5v13l11-6.5z" />
                  </svg>
                )}
              </button>
              <button type="button" aria-label={`Forward ${SKIP} seconds`} title={`Forward ${SKIP} seconds`} onClick={() => onSeek(Math.min(duration, position + SKIP))} className={iconBtn}>
                <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="currentColor">
                  <path d="M11 5v10l7-5zM3 5v10l7-5z" />
                </svg>
              </button>
            </div>
            <div className="flex w-full items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
              <span className="w-9 text-right font-mono">{fmt(shownPos)}</span>
              <input
                type="range"
                min={0}
                max={Math.max(duration, 0.1)}
                step={0.1}
                value={Math.min(shownPos, duration)}
                aria-label="Position"
                aria-valuetext={`${fmt(shownPos)} of ${fmt(duration)}`}
                onChange={(e) => {
                  const t = Number(e.target.value)
                  // a drag waits for the release; arrow keys seek at once
                  if (drag !== null) setDrag(t)
                  else onSeek(t)
                }}
                onPointerDown={() => setDrag(position)}
                onPointerUp={(e) => {
                  setDrag(null)
                  onSeek(Number(e.currentTarget.value))
                }}
                className="h-1 min-w-0 flex-1 cursor-pointer accent-primary"
              />
              <span className="w-9 font-mono">{fmt(duration)}</span>
            </div>
            {bar && <p className="hidden text-[10px] text-muted-foreground md:block">{bar}</p>}
          </div>

          {/* tools */}
          <div className="order-2 flex shrink-0 items-center justify-end gap-1 md:order-3">{tools}</div>
        </div>
      </div>
    </div>
  )
}
