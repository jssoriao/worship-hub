import { useEffect, useMemo, useRef, useState } from 'react'
import { EditPopover } from './EditPopover'
import { chordName, indexAt, type ChordLevel, type SongAnalysis } from '../../lib/analysis'

interface Props {
  analysis: SongAnalysis
  level: ChordLevel
  position: number
  onSeek: (t: number) => void
  /** keep the line being sung in view */
  follow: boolean
  /** edit mode: tap a line to change its words */
  editing?: boolean
  onLine?: (index: number, text: string) => void
  onDeleteLine?: (index: number) => void
  onJoinLine?: (index: number) => void
}

type Token = { w: string; t: number; end: number; chords: string[] }
type Row = { kind: 'section'; label: string; t: number } | { kind: 'chords'; t: number; chords: string[] } | { kind: 'line'; index: number; t: number; end: number; tokens: Token[] }

const LEAD = 0.25 // a chord this much before a word still belongs to it

/**
 * Builds the sheet: section headings, rows of chords where nothing is sung (intro, instrumentals),
 * and lyric lines with each chord over the word being sung when it starts.
 */
function buildRows(a: SongAnalysis, level: ChordLevel): Row[] {
  const changes: { t: number; name: string }[] = []
  for (const c of a.chords) {
    const name = chordName(c, level)
    if (!name) continue
    if (changes.length && changes[changes.length - 1].name === name) continue
    changes.push({ t: c.t, name })
  }
  const lines = a.lines.map((l, index) => ({ ...l, index })).filter((l) => l.words.length > 0)
  const rows: Row[] = []
  let ci = 0
  let si = 0
  const sectionsUpTo = (t: number) => {
    while (si < a.sections.length && a.sections[si].t <= t + 0.5) {
      const s = a.sections[si++]
      rows.push({ kind: 'section', label: s.label, t: s.t })
    }
  }
  // chords before `t` that are not over a word: one row per section part
  const chordsUntil = (t: number) => {
    let group: string[] = []
    let groupT = 0
    while (ci < changes.length && changes[ci].t < t - LEAD) {
      const c = changes[ci]
      // a section starting here gets its heading before the chords that follow it
      if (si < a.sections.length && a.sections[si].t <= c.t + 0.5) {
        if (group.length) rows.push({ kind: 'chords', t: groupT, chords: group })
        group = []
        sectionsUpTo(c.t)
      }
      if (group.length === 0) groupT = c.t
      group.push(c.name)
      ci++
    }
    if (group.length) rows.push({ kind: 'chords', t: groupT, chords: group })
  }
  for (const line of lines) {
    chordsUntil(line.t)
    sectionsUpTo(line.t)
    const tokens: Token[] = line.words.map((w) => ({ w: w.w, t: w.t, end: w.end, chords: [] }))
    while (ci < changes.length && changes[ci].t < line.end) {
      const c = changes[ci++]
      // the word sounding when the chord starts, or the next one
      let k = tokens.findIndex((tk, i) => c.t < (tokens[i + 1]?.t ?? Infinity) - LEAD && c.t >= tk.t - LEAD)
      if (k < 0) k = c.t < tokens[0].t ? 0 : tokens.length - 1
      tokens[k].chords.push(c.name)
    }
    rows.push({ kind: 'line', index: line.index, t: line.t, end: line.end, tokens })
  }
  chordsUntil(Infinity)
  sectionsUpTo(Infinity)
  return rows
}

/** Chords over the lyrics, by section; the line being sung is bright and its words light up as they are sung. */
export function LyricsView({ analysis, level, position, onSeek, follow, editing = false, onLine, onDeleteLine, onJoinLine }: Props) {
  const [open, setOpen] = useState<number | null>(null)
  const rows = useMemo(() => buildRows(analysis, level), [analysis, level])
  const lines = useMemo(() => rows.flatMap((r, i) => (r.kind === 'line' ? [{ i, t: r.t }] : [])), [rows])
  const at = indexAt(lines, position)
  const activeRow = at >= 0 ? lines[at].i : -1
  const rowRefs = useRef<(HTMLElement | null)[]>([])

  useEffect(() => {
    if (!follow || activeRow < 0) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    rowRefs.current[activeRow]?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
  }, [activeRow, follow])

  if (analysis.lines.length === 0) return <p className="mt-6 text-center text-sm text-slate-400">No lyrics for this song.</p>

  return (
    <div className="mx-auto mt-3 max-w-4xl space-y-1 pb-32">
      {rows.map((r, i) => {
        if (r.kind === 'section')
          return (
            <h3 key={i} className="pt-4 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              {r.label}
            </h3>
          )
        if (r.kind === 'chords')
          return (
            <button key={i} type="button" onClick={() => onSeek(r.t)} className="flex flex-wrap gap-x-4 text-left text-sm font-semibold text-teal-300/80 outline-none hover:text-teal-200 focus-visible:ring-2 focus-visible:ring-teal-400">
              {r.chords.map((c, k) => (
                <span key={k}>{c}</span>
              ))}
            </button>
          )
        const current = i === activeRow
        const past = activeRow >= 0 && i < activeRow
        const text = r.tokens.map((tk) => tk.w).join(' ')
        return (
          <div key={i}>
          <button
            ref={(el) => {
              rowRefs.current[i] = el
            }}
            type="button"
            onClick={() => (editing ? setOpen(r.index) : onSeek(r.t))}
            aria-label={editing ? `Edit line: ${text}` : undefined}
            aria-current={current ? 'true' : undefined}
            className={`flex w-full flex-wrap gap-x-[0.35em] py-1 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-teal-400 ${current ? 'text-white' : past ? 'text-slate-500' : 'text-slate-400'}`}
          >
            {r.tokens.map((tk, k) => {
              const sung = current && position >= tk.t
              return (
                <span key={k} className="inline-flex flex-col">
                  <span className={`h-5 whitespace-nowrap pr-1 text-sm font-semibold leading-5 lg:h-6 lg:text-base lg:leading-6 ${current ? 'text-teal-300' : 'text-teal-400/60'}`}>{tk.chords.join(' ')}</span>
                  <span className={`text-xl leading-snug sm:text-2xl lg:text-3xl ${sung ? 'text-teal-100' : ''}`}>{tk.w}</span>
                </span>
              )
            })}
          </button>
          {editing && open === r.index && (
            <EditPopover
              title="Words of this line (put a | where it should break into two lines)"
              initial={text}
              actions={[
                { label: 'Join with next', onClick: () => (onJoinLine?.(r.index), setOpen(null)) },
                { label: 'Delete line', onClick: () => (onDeleteLine?.(r.index), setOpen(null)) },
              ]}
              onSave={(v) => {
                onLine?.(r.index, v)
                setOpen(null)
              }}
              onCancel={() => setOpen(null)}
            />
          )}
          </div>
        )
      })}
    </div>
  )
}
