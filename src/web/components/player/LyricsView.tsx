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
  /** the line's words are right as they are (clears its doubts) */
  onApproveLine?: (index: number) => void
  /** play from a moment of the song, to hear a line */
  onListen?: (t: number) => void
}

type Token = { w: string; t: number; end: number; chords: string[]; doubt?: boolean }
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
    const tokens: Token[] = line.words.map((w) => ({ w: w.w, t: w.t, end: w.end, chords: [], doubt: w.doubt !== undefined }))
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
export function LyricsView({ analysis, level, position, onSeek, follow, editing = false, onLine, onDeleteLine, onJoinLine, onApproveLine, onListen }: Props) {
  const [open, setOpen] = useState<number | null>(null)
  const rows = useMemo(() => buildRows(analysis, level), [analysis, level])
  // checking the lines the speech-to-text was unsure of, one after another: `cursor` is the first line still to look at
  const doubtful = useMemo(() => rows.flatMap((r) => (r.kind === 'line' && r.tokens.some((tk) => tk.doubt) ? [r.index] : [])), [rows])
  const [reviewing, setReviewing] = useState(false)
  const [cursor, setCursor] = useState(0)
  const reviewLine = editing && reviewing ? (doubtful.find((i) => i >= cursor) ?? null) : null
  // the end of the list: everything checked, or only the lines that were skipped are left
  const atEnd = editing && reviewing && reviewLine === null
  const allChecked = atEnd && doubtful.length === 0
  const lines = useMemo(() => rows.flatMap((r, i) => (r.kind === 'line' ? [{ i, t: r.t }] : [])), [rows])
  const at = indexAt(lines, position)
  const activeRow = at >= 0 ? lines[at].i : -1
  const rowRefs = useRef<(HTMLElement | null)[]>([])

  // checking: bring the line being checked into view
  useEffect(() => {
    if (reviewLine === null) return
    const row = rows.findIndex((r) => r.kind === 'line' && r.index === reviewLine)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    rowRefs.current[row]?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
  }, [reviewLine, rows])

  useEffect(() => {
    if (!follow || activeRow < 0) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    rowRefs.current[activeRow]?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
  }, [activeRow, follow])

  if (analysis.lines.length === 0) return <p className="mt-6 text-center text-sm text-muted-foreground">No lyrics for this song.</p>

  return (
    <div className="mx-auto mt-3 max-w-4xl space-y-1 pb-32">
      {editing && (doubtful.length > 0 || allChecked) && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm">
          <span className="mr-auto text-amber-200">
            {allChecked ? 'All checked' : atEnd ? `${doubtful.length} skipped` : `${doubtful.length} ${doubtful.length === 1 ? 'line' : 'lines'} to check`}
          </span>
          {[
            ...(atEnd && !allChecked ? [{ label: 'Check again', go: () => setCursor(0) }] : []),
            {
              label: allChecked ? 'Done' : reviewing ? 'Stop' : 'Check them',
              go: () => {
                setOpen(null)
                setCursor(0)
                setReviewing(!reviewing)
              },
            },
          ].map((b) => (
            <button
              key={b.label}
              type="button"
              onClick={b.go}
              className="rounded-lg border border-amber-400/60 px-3 py-1 text-amber-100 outline-none hover:bg-amber-400/20 focus-visible:ring-2 focus-visible:ring-ring"
            >
              {b.label}
            </button>
          ))}
        </div>
      )}
      {rows.map((r, i) => {
        if (r.kind === 'section')
          return (
            <h3 key={i} className="pt-4 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {r.label}
            </h3>
          )
        if (r.kind === 'chords')
          return (
            <button key={i} type="button" onClick={() => onSeek(r.t)} className="flex flex-wrap gap-x-4 text-left text-sm font-semibold text-highlight/80 outline-none hover:text-highlight focus-visible:ring-2 focus-visible:ring-ring">
              {r.chords.map((c, k) => (
                <span key={k}>{c}</span>
              ))}
            </button>
          )
        const current = i === activeRow
        const past = activeRow >= 0 && i < activeRow
        const text = r.tokens.map((tk) => tk.w).join(' ')
        const check = editing && r.tokens.some((tk) => tk.doubt)
        const isOpen = editing && (open === r.index || reviewLine === r.index)
        const checking = reviewLine === r.index
        // after this line is dealt with: the next one to check, or just close it
        const next = (from: number) => (checking ? setCursor(from) : setOpen(null))
        return (
          <div key={i}>
          <button
            ref={(el) => {
              rowRefs.current[i] = el
            }}
            type="button"
            onClick={() => {
              if (!editing) return onSeek(r.t)
              setReviewing(false)
              setOpen(r.index)
            }}
            aria-label={editing ? `${check ? 'Check' : 'Edit'} line: ${text}` : undefined}
            aria-current={current ? 'true' : undefined}
            className={`flex w-full flex-wrap gap-x-[0.35em] py-1 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${current ? 'text-white' : past ? 'text-muted-foreground' : 'text-muted-foreground'} ${check ? 'border-l-2 border-amber-400/70 pl-2' : ''}`}
          >
            {r.tokens.map((tk, k) => {
              const sung = current && position >= tk.t
              return (
                <span key={k} className="inline-flex flex-col">
                  <span className={`h-5 whitespace-nowrap pr-1 text-sm font-semibold leading-5 lg:h-6 lg:text-base lg:leading-6 ${current ? 'text-highlight' : 'text-highlight/60'}`}>{tk.chords.join(' ')}</span>
                  <span className={`text-xl leading-snug sm:text-2xl lg:text-3xl ${sung ? 'text-highlight' : ''} ${editing && tk.doubt ? 'underline decoration-amber-400 decoration-wavy decoration-2 underline-offset-4' : ''}`}>{tk.w}</span>
                </span>
              )
            })}
          </button>
          {isOpen && (
            <EditPopover
              key={r.index}
              title={checking ? 'Check this line (put a | where it should break into two lines)' : 'Words of this line (put a | where it should break into two lines)'}
              initial={text}
              actions={[
                ...(onListen ? [{ label: 'Listen', onClick: () => onListen(Math.max(0, r.t - 0.5)) }] : []),
                ...(check ? [{ label: 'Approve', onClick: () => (onApproveLine?.(r.index), next(r.index + 1)) }] : []),
                ...(checking ? [{ label: 'Skip', onClick: () => setCursor(r.index + 1) }] : []),
                { label: 'Join with next', onClick: () => (onJoinLine?.(r.index), next(r.index)) },
                { label: 'Delete line', onClick: () => (onDeleteLine?.(r.index), next(r.index)) },
              ]}
              onSave={(v) => {
                onLine?.(r.index, v)
                next(r.index + 1)
              }}
              onCancel={() => (setOpen(null), setReviewing(false))}
            />
          )}
          </div>
        )
      })}
    </div>
  )
}
