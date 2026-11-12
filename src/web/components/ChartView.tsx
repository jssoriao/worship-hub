import { formatTime, type Chart } from '../lib/chart'

interface Props {
  chart: Chart
  /** index of the section to highlight, -1 for none */
  active?: number
  /** when set, cue times are buttons that call this with the time */
  onJump?: (t: number) => void
  /** receives each section's element, so the page can scroll to the active one */
  sectionRef?: (index: number, el: HTMLElement | null) => void
}

/** A chart as chords over lyrics, one box per section. */
export default function ChartView({ chart, active = -1, onJump, sectionRef }: Props) {
  return (
    <div className="space-y-3">
      {chart.sections.map((section, i) => {
        const current = i === active
        return (
          <section
            key={i}
            ref={(el) => sectionRef?.(i, el)}
            aria-current={current ? 'true' : undefined}
            className={`rounded-xl border px-3 py-2 ${current ? 'border-teal-400/70 bg-teal-400/10' : 'border-slate-800'}`}
          >
            {(section.label || section.t !== null) && (
              <h3 className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                {section.label}
                {section.t !== null &&
                  (onJump ? (
                    <button
                      type="button"
                      onClick={() => onJump(section.t!)}
                      className="rounded-full border border-slate-700 px-2 py-0.5 font-mono normal-case tracking-normal text-slate-300 outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-teal-400"
                      aria-label={`Play from ${section.label || 'here'} at ${formatTime(section.t)}`}
                    >
                      ▶ {formatTime(section.t)}
                    </button>
                  ) : (
                    <span className="font-mono normal-case tracking-normal text-slate-500">{formatTime(section.t)}</span>
                  ))}
              </h3>
            )}
            {section.lines.map((line, j) => (
              <div key={j} className="flex flex-wrap leading-tight">
                {line.map((seg, k) => (
                  <span key={k} className="inline-flex flex-col">
                    <span className="min-h-[1.25em] whitespace-pre pr-2 text-sm font-semibold text-teal-300">{seg.chord}</span>
                    <span className="whitespace-pre pb-1 text-base">{seg.text === '' && seg.chord !== '' ? '\u00a0' : seg.text}</span>
                  </span>
                ))}
              </div>
            ))}
          </section>
        )
      })}
    </div>
  )
}
