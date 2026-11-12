import { useEffect, useMemo, useRef, useState } from 'react'
import { barsOf, chordAt, chordChanges, chordName, indexAt, type ChordLevel, type SongAnalysis } from '../../lib/analysis'
import type { StemInfo } from '../../lib/engine'
import type { MixState } from '../../lib/mix'
import { Waveform } from '../Waveform'

export interface TimelineStem {
  index: number
  stem: StemInfo
  mix: MixState
  audible: boolean
  waiting: boolean
  note?: string
  /** a combined stem: its parts can be shown under it */
  parts: number[]
}

interface Props {
  rows: TimelineStem[]
  /** every stem by index (for the parts) */
  byIndex: Map<number, TimelineStem>
  duration: number
  position: number
  onSeek: (seconds: number) => void
  onPatch: (index: number, patch: Partial<MixState>) => void
  analysis: SongAnalysis | null
  level: ChordLevel
  click?: { on: boolean; volume: number; onToggle: () => void; onVolume: (v: number) => void }
}

const LANE_COLOURS = ['bg-primary/60', 'bg-sky-800/70', 'bg-indigo-800/70', 'bg-violet-800/70', 'bg-fuchsia-900/70', 'bg-amber-800/70']

/**
 * The stems on one shared timeline, as in a DAW: a strip of the coming chords as beat boxes, a bar
 * ruler, lanes for sections, chords and lyrics, then a slim row per stem (volume, M/S, waveform),
 * all under one playhead. Tap any lane to play from there. For wide screens.
 */
export function StemTimeline({ rows, byIndex, duration, position, onSeek, onPatch, analysis, level, click }: Props) {
  const [open, setOpen] = useState<Set<number>>(new Set())

  // fill the window from where the box starts down to the play bar (the dock, App.tsx); the stems scroll inside it
  const box = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>()
  useEffect(() => {
    const dock = document.querySelector<HTMLElement>('[data-player-dock]')
    const fit = () => {
      const el = box.current
      if (!el) return
      const top = el.getBoundingClientRect().top + window.scrollY
      // the dock holds the play bar and the views above it; keep a small gap over them
      const reserve = (dock?.getBoundingClientRect().height ?? 0) + 12
      setHeight(Math.max(240, Math.floor(window.innerHeight - top - reserve)))
    }
    fit()
    const watch = new ResizeObserver(fit)
    if (dock) watch.observe(dock)
    if (box.current?.parentElement) watch.observe(box.current.parentElement)
    window.addEventListener('resize', fit)
    return () => {
      watch.disconnect()
      window.removeEventListener('resize', fit)
    }
  }, [])
  const pct = (t: number) => `${duration > 0 ? Math.min(100, Math.max(0, (t / duration) * 100)) : 0}%`
  const progress = duration > 0 ? position / duration : 0
  const seekAt = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    onSeek(Math.min(1, Math.max(0, (e.clientX - r.left) / Math.max(1, r.width))) * duration)
  }

  const bars = useMemo(() => (analysis ? barsOf(analysis.beats) : []), [analysis])
  const changes = useMemo(() => (analysis ? chordChanges(analysis, level) : []), [analysis, level])

  // the chord strip: this bar and the next three, a box per beat
  const barStarts = useMemo(() => bars.map((b) => ({ t: b[0].t })), [bars])
  const bar = Math.max(0, indexAt(barStarts, position))
  const strip = bars.slice(bar, bar + 4)

  const row = (r: TimelineStem, part = false) => {
    const isOpen = open.has(r.index)
    return (
      <div key={r.index} className={`flex h-14 items-stretch border-b border-border/80 ${part ? 'bg-background/40' : ''}`}>
        <div className={`flex w-56 shrink-0 flex-col justify-center gap-1 border-r border-border px-2 ${part ? 'pl-6' : ''}`}>
          <div className="flex items-center gap-1">
            {r.parts.length > 0 ? (
              <button
                type="button"
                aria-expanded={isOpen}
                aria-label={`${isOpen ? 'Hide' : 'Show'} the parts of ${r.stem.name}`}
                onClick={() => setOpen((s) => (s.has(r.index) ? new Set([...s].filter((x) => x !== r.index)) : new Set([...s, r.index])))}
                className="w-4 text-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {isOpen ? '▾' : '▸'}
              </button>
            ) : (
              <span className="w-4" />
            )}
            <span className={`min-w-0 flex-1 truncate text-sm ${r.parts.length ? 'font-semibold' : 'font-medium'} ${r.audible ? '' : 'text-muted-foreground'}`} title={r.note}>
              {r.stem.name}
            </span>
            <button
              aria-pressed={r.mix.muted}
              aria-label={`Mute ${r.stem.name}`}
              onClick={() => onPatch(r.index, { muted: !r.mix.muted })}
              className={`h-6 w-6 rounded text-xs font-bold ${r.mix.muted ? 'bg-red-600 text-white' : 'bg-accent text-slate-300'}`}
            >
              M
            </button>
            <button
              aria-pressed={r.mix.solo}
              aria-label={`Solo ${r.stem.name}`}
              onClick={() => onPatch(r.index, { solo: !r.mix.solo })}
              className={`h-6 w-6 rounded text-xs font-bold ${r.mix.solo ? 'bg-amber-500 text-slate-950' : 'bg-accent text-slate-300'}`}
            >
              S
            </button>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={r.mix.volume}
            aria-label={`Volume ${r.stem.name}`}
            onChange={(e) => onPatch(r.index, { volume: Number(e.target.value) })}
            className="ml-5 w-[calc(100%-1.25rem)] accent-primary"
          />
        </div>
        <div className={`min-w-0 flex-1 px-0 py-1 ${r.waiting ? 'animate-pulse' : ''}`} aria-busy={r.waiting}>
          {r.stem.peaks.length > 0 ? (
            <Waveform peaks={r.stem.peaks} progress={progress} height={44} dim={!r.audible} onSeek={(f) => onSeek(f * duration)} />
          ) : (
            <div className="h-11 rounded bg-accent/40" aria-hidden="true" />
          )}
        </div>
      </div>
    )
  }

  // the playhead, drawn over the lanes and again over the stems
  const playhead = (
    <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-56 right-0">
      <div className="absolute inset-y-0 w-0.5 bg-white/90" style={{ left: pct(position) }} />
    </div>
  )

  const lane = (label: string, children: React.ReactNode, h = 'h-6') => (
    <div className={`flex ${h} items-stretch border-b border-border/80`}>
      <div className="flex w-56 shrink-0 items-center border-r border-border px-2 text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="relative min-w-0 flex-1 cursor-pointer overflow-hidden" onClick={seekAt} aria-hidden="true">
        {children}
      </div>
    </div>
  )

  return (
    <div className="mt-3">
      {analysis && strip.length > 0 && (
        <div aria-label="Coming chords" className="mb-2 grid grid-cols-4 gap-2">
          {strip.map((beats, i) => {
            let prev = i === 0 ? '' : chordName(chordAt(analysis, strip[i - 1][strip[i - 1].length - 1].t + 0.02), level)
            return (
              <div key={bar + i} className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${Math.min(beats.length, 4)}, minmax(0, 1fr))` }}>
                {beats.slice(0, 4).map((b, k) => {
                  const name = chordName(chordAt(analysis, b.t + 0.02), level)
                  const show = name && (name !== prev || k === 0) ? name : ''
                  const held = show !== '' && name === prev
                  prev = name || prev
                  const now = i === 0 && position >= b.t && position < (beats[k + 1]?.t ?? strip[1]?.[0].t ?? b.t + 1)
                  return (
                    <div key={k} className={`flex h-12 items-center rounded px-2 text-lg font-semibold ${now ? 'bg-primary text-white' : k === 0 ? 'border-l-2 border-slate-500 bg-accent' : 'bg-accent/70'} ${held && !now ? 'text-muted-foreground' : ''}`}>
                      {show}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}

      <div ref={box} style={{ height }} className="flex flex-col overflow-hidden rounded-xl border border-border bg-card/60">
        {/* the song lanes stay put; the same gutter as the stems below keeps them lined up */}
        {analysis && (
          <div className="relative shrink-0 overflow-y-hidden [scrollbar-gutter:stable]">
            {lane(
              'Bars',
              bars.map((b, i) =>
                i % 8 === 0 ? (
                  <span key={i} className="absolute top-0 h-full border-l border-slate-600 pl-0.5 text-[10px] leading-6 text-muted-foreground" style={{ left: pct(b[0].t) }}>
                    {i + 1}
                  </span>
                ) : null,
              ),
              'h-5',
            )}
            {lane(
              'Sections',
              analysis.sections.map((s, i) => (
                <span
                  key={i}
                  title={s.label}
                  className={`absolute top-0.5 bottom-0.5 truncate rounded-sm border-r border-slate-950 px-1 text-[11px] leading-5 text-white ${LANE_COLOURS[i % LANE_COLOURS.length]}`}
                  style={{ left: pct(s.t), width: `calc(${pct(s.end - s.t)} - 1px)` }}
                >
                  {s.label}
                </span>
              )),
            )}
            {lane(
              'Chords',
              changes.map((c, i) => (
                // just where the chords change: names are too cramped here (the strip above has them)
                <span key={i} title={c.name} className="absolute top-1.5 bottom-1.5 border-l-2 border-highlight/50" style={{ left: pct(c.t) }} />
              )),
            )}
            {lane(
              'Lyrics',
              analysis.lines.map((l, i) => (
                <span key={i} title={l.words.map((w) => w.w).join(' ')} className="absolute top-1.5 h-3 rounded-sm bg-slate-500/60" style={{ left: pct(l.t), width: pct(l.end - l.t) }} />
              )),
            )}
            {playhead}
          </div>
        )}

        <div aria-label="Stems" className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
        {/* room at the end, so the last stem can scroll clear of the views floating over it */}
        <div className="relative mb-14">
        {rows.map((r) => (
          <div key={r.index}>
            {row(r)}
            {open.has(r.index) && r.parts.map((p) => byIndex.get(p)).map((p) => (p ? row(p, true) : null))}
          </div>
        ))}

        {click && (
          <div className="flex h-12 items-stretch">
            <div className="flex w-56 shrink-0 items-center gap-2 border-r border-border px-2">
              <span className="w-4" />
              <span className={`flex-1 text-sm font-medium ${click.on ? '' : 'text-muted-foreground'}`}>Click</span>
              <input type="range" min={0} max={1} step={0.01} value={click.volume} aria-label="Click volume" onChange={(e) => click.onVolume(Number(e.target.value))} className="w-20 accent-primary" />
              <button aria-pressed={click.on} aria-label={click.on ? 'Click on: turn off' : 'Click off: turn on'} onClick={click.onToggle} className={`h-6 rounded px-1.5 text-xs font-bold ${click.on ? 'bg-primary text-white' : 'bg-accent text-slate-300'}`}>
                {click.on ? 'On' : 'Off'}
              </button>
            </div>
            <div className="relative min-w-0 flex-1 cursor-pointer" onClick={seekAt} aria-hidden="true">
              {analysis &&
                bars.map((b, i) => <span key={i} className={`absolute top-3 bottom-3 w-px ${click.on ? 'bg-slate-500' : 'bg-slate-700'}`} style={{ left: pct(b[0].t) }} />)}
            </div>
          </div>
        )}

        {playhead}
        </div>
        </div>
      </div>
    </div>
  )
}
