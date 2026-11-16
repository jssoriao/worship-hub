import { useEffect, useMemo, useRef, useState } from 'react'
import { CopyFrom } from './CopyFrom'
import { EditPopover } from './EditPopover'
import { barsOf, chordAt, chordName, halfBeatChord, halfBeatTime, indexAt, type ChordLevel, type SongAnalysis } from '../../lib/analysis'
import { Segmented } from './panels'

interface Props {
  analysis: SongAnalysis
  level: ChordLevel
  position: number
  onSeek: (t: number) => void
  follow: boolean
  /** edit mode: tap a beat to set its chord, a bar number for its section */
  editing?: boolean
  onChord?: (t: number, name: string) => void
  /** takes away the chord change that starts at `t` (a chord on the half beat) */
  onRemoveChord?: (t: number) => void
  onSection?: (t: number, label: string | null) => void
  /** copy the chords of section `from` onto section `to` (indexes in the analysis' sections) */
  onCopySection?: (from: number, to: number) => void
}

/**
 * The song as bars of beat boxes: a chord where it changes (a held chord shown faintly at the start
 * of a bar), the box of the beat being played lit, section names where they start. Tap a box to
 * play from that beat. A chord that changes between two beats (on the "and") splits its beat's box in two:
 * the chord on the beat on the left, the new one on the right. In edit mode a chord is placed "on the beat"
 * (the default) or on the half beat.
 */
export function ChordGrid({ analysis, level, position, onSeek, follow, editing = false, onChord, onRemoveChord, onSection, onCopySection }: Props) {
  // `empty`: a beat where no chord starts (its box is blank), so there is nothing to change yet; `k`/`half`: which beat of the bar, and whether the chord is on its half beat
  const [open, setOpen] = useState<{ kind: 'chord' | 'section'; bar: number; k?: number; half?: boolean; t: number; value: string; empty?: boolean } | null>(null)
  // the section heading (by bar) whose copy box is open
  const [copying, setCopying] = useState<number | null>(null)
  // the song's chords, for quick picks
  const used = useMemo(() => [...new Set(analysis.chords.map((c) => chordName(c, 'complex')).filter(Boolean))].sort(), [analysis.chords])
  const bars = useMemo(() => {
    const grouped = barsOf(analysis.beats)
    const flat = grouped.flat()
    // walk the beats in order, each with its half beat, remembering the last chord to tell a change from a held chord
    let last = ''
    const slots: { on: string; change: boolean; halfT: number; half?: { name: string; t: number; full: string } }[] = []
    for (let i = 0; i < flat.length; i++) {
      const on = chordName(chordAt(analysis, flat[i].t + 0.02), level)
      const change = on !== '' && on !== last
      if (on) last = on
      const halfChord = halfBeatChord(analysis, flat, i)
      const halfName = chordName(halfChord, level)
      const halfChange = halfName !== '' && halfName !== last
      if (halfName) last = halfName
      slots.push({ on, change, halfT: halfBeatTime(flat, i), half: halfChord && halfChange ? { name: halfName, t: halfChord.t, full: chordName(halfChord, 'complex') } : undefined })
    }
    const firstOf = grouped.map((_, g) => grouped.slice(0, g).reduce((n, b) => n + b.length, 0))
    return grouped.map((beats, g) =>
      beats.map((b, k) => {
        const s = slots[firstOf[g] + k]
        return { t: b.t, halfT: s.halfT, half: s.half, name: s.change || (k === 0 && s.on) ? s.on : '', held: !s.change && k === 0 && s.on !== '' }
      }),
    )
  }, [analysis, level])
  const starts = useMemo(() => bars.map((b) => ({ t: b[0].t })), [bars])
  // what the chord box says for a beat: on the beat, or on its half beat. A blank spot opens blank (the chord sounding there
  // came from an earlier beat), and saving it blank changes nothing.
  const boxFor = (bar: number, k: number, half: boolean) => {
    const b = bars[bar][k]
    return {
      kind: 'chord' as const,
      bar,
      k,
      half,
      t: half ? (b.half?.t ?? b.halfT) : b.t,
      value: half ? (b.half?.full ?? '') : b.name ? chordName(chordAt(analysis, b.t + 0.02), 'complex') : '',
      empty: half ? !b.half : !b.name,
    }
  }
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
                const tone = now ? 'border-highlight/70 bg-primary text-white' : k === 0 ? 'border-slate-500 bg-accent' : 'border-transparent bg-accent/70'
                const press = (half: boolean) => (editing ? setOpen(boxFor(i, k, half)) : onSeek(half ? (b.half?.t ?? b.halfT) : b.t))
                const label = `Bar ${i + 1}, beat ${k + 1}${b.name ? `, ${b.name}` : ''}${editing ? ': edit chord' : ''}`
                if (b.half) {
                  // a chord changes between this beat and the next: the box splits, the new chord on the right
                  return (
                    <div key={k} className={`flex h-11 overflow-hidden rounded-md border-l-2 text-sm font-semibold transition-colors ${tone} ${b.held && !now ? 'text-muted-foreground' : ''}`}>
                      <button type="button" onClick={() => press(false)} aria-label={label} className="flex min-w-0 flex-1 items-center justify-center px-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        <span className="truncate">{b.name}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => press(true)}
                        aria-label={`Bar ${i + 1}, beat ${k + 1} and, ${b.half.name}${editing ? ': edit chord' : ''}`}
                        className={`flex min-w-0 flex-1 items-center justify-center border-l border-white/15 px-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring ${now ? '' : 'text-highlight'}`}
                      >
                        <span className="truncate">{b.half.name}</span>
                      </button>
                    </div>
                  )
                }
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => press(false)}
                    aria-label={label}
                    className={`flex h-11 items-center justify-center rounded-md border-l-2 text-lg font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${tone} ${b.held && !now ? 'text-muted-foreground' : ''}`}
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
                  key={`${open.bar}-${open.k}-${open.half ? 'half' : 'beat'}`}
                  title={`${open.empty ? 'New chord at' : 'Chord from'} bar ${i + 1}, beat ${(open.k ?? 0) + 1}${open.half ? ' and' : ''}`}
                  initial={open.value}
                  placeholder="e.g. D/F#"
                  suggestions={used}
                  actions={[
                    ...(open.half && !open.empty ? [{ label: 'Remove', onClick: () => (onRemoveChord?.(open.t), setOpen(null)) }] : []),
                    // a bar's first beat can also start (or rename) the section, as the bar number does
                    ...(!open.half && open.k === 0 && onSection
                      ? [{ label: sectionAt.has(i) ? 'Rename section' : 'Start a section', onClick: () => setOpen({ kind: 'section', bar: i, t: beats[0].t, value: sectionAt.get(i) ?? '' }) }]
                      : []),
                  ]}
                  onSave={(v) => {
                    // saving a blank beat as it is changes nothing; emptying a chord and saving clears it
                    if (!(open.empty && v.trim() === '')) onChord?.(open.t, v)
                    setOpen(null)
                  }}
                  onCancel={() => setOpen(null)}
                >
                  {/* a chord that changes between two beats goes on the half beat, the "and" */}
                  <div className="mt-2">
                    <Segmented
                      label="Where in the beat"
                      value={open.half ? 'half' : 'beat'}
                      options={[
                        ['beat', 'On the beat'],
                        ['half', 'Half beat'],
                      ]}
                      onChange={(v) => setOpen(boxFor(open.bar, open.k ?? 0, v === 'half'))}
                    />
                  </div>
                </EditPopover>
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
