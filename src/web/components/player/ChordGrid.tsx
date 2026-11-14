import { useEffect, useMemo, useRef, useState } from 'react'
import { CopyFrom } from './CopyFrom'
import { EditPopover } from './EditPopover'
import { barsOf, chordAt, chordName, indexAt, type ChordLevel, type SongAnalysis } from '../../lib/analysis'

interface Props {
  analysis: SongAnalysis
  level: ChordLevel
  position: number
  onSeek: (t: number) => void
  follow: boolean
  /** edit mode: tap a beat to set its chord, a bar number for its section */
  editing?: boolean
  onChord?: (t: number, name: string) => void
  onSection?: (t: number, label: string | null) => void
  /** copy the chords of section `from` onto section `to` (indexes in the analysis' sections) */
  onCopySection?: (from: number, to: number) => void
}

/**
 * The song as bars of beat boxes: a chord where it changes (a held chord shown faintly at the start
 * of a bar), the box of the beat being played lit, section names where they start. Tap a box to
 * play from that beat.
 */
export function ChordGrid({ analysis, level, position, onSeek, follow, editing = false, onChord, onSection, onCopySection }: Props) {
  // `empty`: a beat where no chord starts (its box is blank), so there is nothing to change yet
  const [open, setOpen] = useState<{ kind: 'chord' | 'section'; bar: number; t: number; value: string; empty?: boolean } | null>(null)
  // the section heading (by bar) whose copy box is open
  const [copying, setCopying] = useState<number | null>(null)
  // the song's chords, for quick picks
  const used = useMemo(() => [...new Set(analysis.chords.map((c) => chordName(c, 'complex')).filter(Boolean))].sort(), [analysis.chords])
  const bars = useMemo(() => {
    const grouped = barsOf(analysis.beats)
    const names = grouped.flat().map((b) => chordName(chordAt(analysis, b.t + 0.02), level))
    // the last chord name before each beat, to tell a change from a held chord
    const before: string[] = []
    names.reduce((last, n, i) => {
      before[i] = last
      return n || last
    }, '')
    const firstOf = grouped.map((_, g) => grouped.slice(0, g).reduce((n, b) => n + b.length, 0))
    return grouped.map((beats, g) =>
      beats.map((b, k) => {
        const i = firstOf[g] + k
        const name = names[i]
        const change = name !== '' && name !== before[i]
        return { t: b.t, name: change || (k === 0 && name) ? name : '', held: !change && k === 0 && name !== '' }
      }),
    )
  }, [analysis, level])
  const starts = useMemo(() => bars.map((b) => ({ t: b[0].t })), [bars])
  // the section that starts in each bar
  const sectionAt = useMemo(() => {
    const map = new Map<number, string>()
    for (const s of analysis.sections) {
      const i = indexAt(starts, s.t + 0.3)
      if (i >= 0 && !map.has(i)) map.set(i, s.label)
    }
    return map
  }, [analysis.sections, starts])

  // the section that starts in each bar, as an index in analysis.sections
  const sectionIndexAt = useMemo(() => {
    const map = new Map<number, number>()
    analysis.sections.forEach((s, k) => {
      const i = indexAt(starts, s.t + 0.3)
      if (i >= 0 && !map.has(i)) map.set(i, k)
    })
    return map
  }, [analysis.sections, starts])
  const bar = indexAt(starts, position)
  const beat = bar >= 0 ? indexAt(bars[bar], position) : -1
  const barRefs = useRef<(HTMLElement | null)[]>([])
  useEffect(() => {
    if (!follow || bar < 0) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    barRefs.current[bar]?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
  }, [bar, follow])

  if (bars.length === 0) return <p className="mt-6 text-center text-sm text-muted-foreground">No beats for this song.</p>

  return (
    <div className="mx-auto mt-3 grid max-w-lg gap-1.5 pb-32 lg:max-w-5xl lg:grid-cols-2 lg:gap-x-6">
      {bars.map((beats, i) => [
        // a section name runs across the row, and its first bar starts on the left
        sectionAt.has(i) && (
          <div key={`h${i}`} className="lg:col-span-2">
            <h3 className="pb-0.5 pl-8 pt-2 text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              {editing && onCopySection ? (
                <button
                  type="button"
                  onClick={() => setCopying(copying === i ? null : i)}
                  aria-label={`Section ${sectionAt.get(i)}: copy chords`}
                  className="rounded uppercase tracking-[0.2em] text-highlight underline decoration-dotted outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {sectionAt.get(i)}
                </button>
              ) : (
                sectionAt.get(i)
              )}
            </h3>
            {editing && onCopySection && copying === i && (
              <div className="pl-8">
                <EditPopover title={`Section ${sectionAt.get(i)}`} initial="" hideField onSave={() => setCopying(null)} onCancel={() => setCopying(null)}>
                  <CopyFrom
                    what="chords"
                    noun="section"
                    options={analysis.sections.flatMap((s, k) => (k === sectionIndexAt.get(i) ? [] : [{ value: k, label: `${s.label} (bar ${indexAt(starts, s.t + 0.3) + 1})` }]))}
                    onCopy={(from) => (onCopySection(from, sectionIndexAt.get(i)!), setCopying(null))}
                  />
                </EditPopover>
              </div>
            )}
          </div>
        ),
        <div
          key={i}
          className={sectionAt.has(i) ? 'lg:col-start-1' : ''}
          ref={(el) => {
            barRefs.current[i] = el
          }}
        >
          <div className="flex items-stretch gap-1.5">
            {editing ? (
              <button
                type="button"
                onClick={() => setOpen({ kind: 'section', bar: i, t: beats[0].t, value: sectionAt.get(i) ?? '' })}
                aria-label={`Section at bar ${i + 1}`}
                className="w-6 shrink-0 self-center rounded text-right text-xs tabular-nums text-highlight underline decoration-dotted outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {i + 1}
              </button>
            ) : (
              <span className="w-6 shrink-0 self-center text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
            )}
            <div className={`grid flex-1 gap-1 ${i === bar ? '' : i < bar ? 'opacity-50' : ''}`} style={{ gridTemplateColumns: `repeat(${Math.min(beats.length, 4)}, minmax(0, 1fr))` }}>
              {beats.map((b, k) => {
                const now = i === bar && k === beat
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() =>
                      editing
                        ? // a blank beat opens blank: the chord of the beat before it is still sounding, but it is not this beat's
                          setOpen({ kind: 'chord', bar: i, t: b.t, value: b.name ? chordName(chordAt(analysis, b.t + 0.02), 'complex') : '', empty: !b.name })
                        : onSeek(b.t)
                    }
                    aria-label={`Bar ${i + 1}, beat ${k + 1}${b.name ? `, ${b.name}` : ''}${editing ? ': edit chord' : ''}`}
                    className={`flex h-11 items-center justify-center rounded-md border-l-2 text-lg font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                      now ? 'border-highlight/70 bg-primary text-white' : k === 0 ? 'border-slate-500 bg-accent' : 'border-transparent bg-accent/70'
                    } ${b.held && !now ? 'text-muted-foreground' : ''}`}
                  >
                    {b.name}
                  </button>
                )
              })}
            </div>
          </div>
          {open && open.bar === i && (
            <div className="pl-8">
              {open.kind === 'chord' ? (
                <EditPopover
                  title={`${open.empty ? 'New chord at' : 'Chord from'} bar ${i + 1}, beat ${bars[i].findIndex((b) => b.t === open.t) + 1}`}
                  initial={open.value}
                  placeholder="e.g. D/F#"
                  suggestions={used}
                  onSave={(v) => {
                    // saving a blank beat as it is changes nothing; emptying a chord and saving clears it
                    if (!(open.empty && v.trim() === '')) onChord?.(open.t, v)
                    setOpen(null)
                  }}
                  onCancel={() => setOpen(null)}
                />
              ) : (
                <EditPopover
                  title={sectionAt.has(i) ? `Section starting at bar ${i + 1}` : `Start a section at bar ${i + 1}`}
                  initial={open.value}
                  placeholder="e.g. Verse 1"
                  suggestions={['Intro', 'Verse', 'Pre-Chorus', 'Chorus', 'Bridge', 'Tag', 'Interlude', 'Outro']}
                  actions={sectionAt.has(i) ? [{ label: 'Remove', onClick: () => (onSection?.(open.t, null), setOpen(null)) }] : []}
                  onSave={(v) => {
                    onSection?.(open.t, v)
                    setOpen(null)
                  }}
                  onCancel={() => setOpen(null)}
                />
              )}
            </div>
          )}
        </div>,
      ])}
    </div>
  )
}
