import { formatTime, lineKind, type ChartLine, type ChartSection } from '../lib/chart'
import { SECTION_CLASS } from '../lib/chart-view'

/** Turns a chord as written into the one to show (transposed, capo shapes, or a number). */
export type ChordShow = (chord: string) => string

/** A line: chords over the words. Lines without words show only the chords, lines without chords only the words. */
export function LineView({ line, show }: { line: ChartLine; show: ChordShow }) {
  const kind = lineKind(line)
  const hasChords = kind !== 'l'
  const hasWords = kind !== 'c'
  if (!hasWords) {
    return (
      <div className="flex flex-wrap gap-x-[1.2em] py-[0.1em] font-semibold leading-snug text-(--chord)">
        {line.filter((seg) => seg.chord).map((seg, k) => (
          <span key={k}>{show(seg.chord)}</span>
        ))}
      </div>
    )
  }
  if (!hasChords) return <div className="whitespace-pre-wrap py-[0.1em] leading-snug">{line.map((seg) => seg.text).join('')}</div>
  return (
    <div className="flex flex-wrap py-[0.1em]">
      {line.map((seg, k) => (
        <span key={k} className="inline-flex flex-col">
          <span className="min-h-[1.2em] whitespace-pre pr-[0.4em] text-[0.85em] font-semibold leading-tight text-(--chord)">{seg.chord ? show(seg.chord) : ''}</span>
          <span className="whitespace-pre-wrap leading-snug">{seg.text === '' ? '\u00a0' : seg.text}</span>
        </span>
      ))}
    </div>
  )
}

interface FragmentProps {
  section: ChartSection
  from: number
  to: number
  header: boolean
  continued: boolean
  show: ChordShow
  active?: boolean
  /** when set, the cue time is a button that seeks there */
  onJump?: (t: number) => void
}

/** Lines [from, to) of a section, with its heading. */
export function SectionFragment({ section, from, to, header, continued, show, active = false, onJump }: FragmentProps) {
  return (
    <section
      aria-current={active ? 'true' : undefined}
      className={`${SECTION_CLASS} ${active ? 'border-(--chord) bg-(--active)' : 'border-transparent'}`}
    >
      {header && <SectionHeading section={section} continued={continued} onJump={onJump} />}
      {section.lines.slice(from, to).map((line, j) => (
        <LineView key={from + j} line={line} show={show} />
      ))}
    </section>
  )
}

export function SectionHeading({ section, continued, onJump }: { section: ChartSection; continued: boolean; onJump?: (t: number) => void }) {
  if (!section.label && section.t === null) return null
  return (
    <h3 className="flex items-center gap-[0.5em] pb-[0.15em] text-[0.7em] font-bold uppercase tracking-wide text-(--muted)">
      <span>
        {section.label}
        {continued && <span className="font-normal normal-case"> (cont.)</span>}
      </span>
      {section.t !== null && !continued &&
        (onJump ? (
          <button
            type="button"
            onClick={() => onJump(section.t!)}
            className="rounded-full border border-(--line) px-[0.6em] font-mono font-normal normal-case tracking-normal outline-none hover:bg-(--hover) focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Play from ${section.label || 'here'} at ${formatTime(section.t)}`}
          >
            ▶ {formatTime(section.t)}
          </button>
        ) : (
          <span className="font-mono font-normal normal-case tracking-normal text-(--muted)">{formatTime(section.t)}</span>
        ))}
    </h3>
  )
}
