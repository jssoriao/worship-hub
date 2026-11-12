import { useMemo } from 'react'
import { chordChanges, indexAt, type ChordLevel, type SongAnalysis } from '../../lib/analysis'
import { ChordShape, type Instrument } from './ChordShape'

interface Props {
  analysis: SongAnalysis
  level: ChordLevel
  instrument: Instrument
  position: number
  onSeek: (t: number) => void
}

/**
 * The chord being played and the ones coming, as guitar or piano shapes, a strip of the next
 * changes, and the line being sung with the next one under it.
 */
export function ShapesView({ analysis, level, instrument, position, onSeek }: Props) {
  const changes = useMemo(() => chordChanges(analysis, level), [analysis, level])
  const at = indexAt(changes, position)
  // before the first chord, show what is coming
  const now = Math.max(0, at)
  const shown = changes.slice(Math.max(0, now - 1), now + 3)
  const strip = changes.slice(Math.max(0, now - 2), now + 6)

  const lines = analysis.lines.filter((l) => l.words.length > 0)
  const li = indexAt(lines, position)
  const line = li >= 0 && position < lines[li].end + 2 ? lines[li] : undefined
  const next = lines[li + 1]

  if (changes.length === 0) return <p className="mt-6 text-center text-sm text-muted-foreground">No chords for this song.</p>

  return (
    <div className="mt-6 flex flex-col items-center gap-6 pb-32">
      <div className="flex flex-wrap items-end justify-center gap-3 sm:gap-5">
        {shown.map((c) => {
          const current = changes.indexOf(c) === at
          return (
            <button key={c.t} type="button" onClick={() => onSeek(c.t)} className="rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Play from ${c.name}`}>
              <ChordShape name={c.name} instrument={instrument} size={current ? 'md' : 'sm'} dim={!current} />
            </button>
          )
        })}
      </div>

      <div aria-hidden="true" className="flex w-full max-w-md gap-1">
        {strip.map((c) => {
          const i = changes.indexOf(c)
          const progress = i < at ? 1 : i > at ? 0 : Math.min(1, Math.max(0, (position - c.t) / Math.max(0.1, c.end - c.t)))
          return (
            <div key={c.t} className="min-w-0 flex-1">
              <p className={`truncate text-center text-xs ${i === at ? 'text-foreground' : 'text-muted-foreground'}`}>{c.name}</p>
              <div className="mt-1 h-1 overflow-hidden rounded bg-slate-700">
                <div className="h-full bg-highlight" style={{ width: `${progress * 100}%` }} />
              </div>
            </div>
          )
        })}
      </div>

      <div className="max-w-2xl text-center" aria-live="polite">
        <p className="min-h-[2.5em] text-2xl font-semibold leading-snug text-white sm:text-3xl">
          {line?.words.map((w, k) => (
            <span key={k} className={position >= w.t ? 'text-highlight' : ''}>
              {w.w}{' '}
            </span>
          ))}
        </p>
        {next && <p className="mt-2 text-lg text-muted-foreground">{next.words.map((w) => w.w).join(' ')}</p>}
      </div>
    </div>
  )
}
