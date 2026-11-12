import { blockStarts, type Arrangement } from '../lib/arrangement'

interface Props {
  arr: Arrangement
  /** count-in seconds before the first block */
  lead: number
  duration: number
  position: number
  onSeek: (seconds: number) => void
  /** the song's waveform over the whole recording (0..1), and the recording's length */
  peaks: number[]
  recording: number
  /** the first beat of each bar, seconds in the recording */
  downbeats: number[]
}

const COLOURS = ['bg-primary/60', 'bg-sky-800', 'bg-indigo-800', 'bg-violet-800', 'bg-fuchsia-900', 'bg-rose-900', 'bg-amber-800', 'bg-lime-900']

/** The part of the waveform from `a` to `b` seconds of the recording, as an SVG path (0..100 wide, 0..1 high, centred). */
function wavePath(peaks: number[], recording: number, a: number, b: number): string {
  if (peaks.length === 0 || recording <= 0 || b <= a) return ''
  const i0 = Math.floor((a / recording) * peaks.length)
  const i1 = Math.max(i0 + 1, Math.ceil((b / recording) * peaks.length))
  const slice = peaks.slice(i0, i1)
  const w = 100 / slice.length
  return slice.map((p, i) => `M${(i * w + w / 2).toFixed(2)} ${(0.5 - p * 0.45).toFixed(3)}V${(0.5 + p * 0.45).toFixed(3)}`).join('')
}

/**
 * The arrangement as a strip of blocks, each as wide as it lasts, with the song's waveform and a
 * line on every bar (stronger every 4). Tap anywhere to put the playhead there.
 */
export function ArrTimeline({ arr, lead, duration, position, onSeek, peaks, recording, downbeats }: Props) {
  const starts = blockStarts(arr, lead)
  const colour = new Map([...new Set(arr.blocks.map((b) => b.section))].map((id, i) => [id, COLOURS[i % COLOURS.length]]))
  const pct = (t: number) => `${duration > 0 ? (t / duration) * 100 : 0}%`
  // where in a block it was tapped, as a time on the timeline
  const at = (e: React.MouseEvent<HTMLElement>, start: number, len: number) => {
    const r = e.currentTarget.getBoundingClientRect()
    return start + Math.min(Math.max((e.clientX - r.left) / Math.max(1, r.width), 0), 1) * len
  }
  return (
    <div className="relative flex h-16 overflow-hidden rounded-lg bg-accent">
      {lead > 0 && (
        <button type="button" onClick={() => onSeek(0)} className="h-full shrink-0 border-r border-slate-950 bg-slate-700 text-[10px] text-slate-300" style={{ width: pct(lead) }} aria-label="Count-in">
          ♩
        </button>
      )}
      {arr.blocks.map((b, i) => {
        const s = arr.sections.find((x) => x.id === b.section)
        if (!s) return null
        const len = s.end - s.start
        const current = position >= starts[i] && position < starts[i] + len
        const bars = downbeats.filter((d) => d >= s.start - 0.01 && d < s.end - 0.01)
        return (
          <button
            key={b.id}
            type="button"
            onClick={(e) => onSeek(at(e, starts[i], len))}
            className={`relative h-full min-w-0 shrink-0 overflow-hidden border-r-2 border-slate-950 text-left text-xs text-white outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${colour.get(b.section)} ${current ? '' : 'opacity-80'}`}
            style={{ width: pct(len) }}
            aria-label={`Block ${i + 1}, ${s.label}: tap to play from there`}
          >
            <svg aria-hidden="true" viewBox="0 0 100 1" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
              {bars.map((d, k) => {
                const x = ((d - s.start) / len) * 100
                return <line key={k} x1={x} x2={x} y1={0} y2={1} stroke="white" strokeOpacity={k % 4 === 0 ? 0.35 : 0.12} strokeWidth={0.15} vectorEffect="non-scaling-stroke" />
              })}
              <path d={wavePath(peaks, recording, s.start, s.end)} stroke="white" strokeOpacity={0.55} strokeWidth={1} vectorEffect="non-scaling-stroke" fill="none" />
            </svg>
            <span className="relative block truncate px-1 pt-0.5 font-medium drop-shadow">{s.label}</span>
            {b.muted.length > 0 && <span className="relative block truncate px-1 text-[10px] opacity-80">−{b.muted.length}</span>}
          </button>
        )
      })}
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-0.5 bg-white" style={{ left: pct(position) }} />
    </div>
  )
}
