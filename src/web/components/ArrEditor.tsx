import { Select } from './Select'
import { useState } from 'react'
import { barsIn, joinWithNext, newId, type Arrangement } from '../lib/arrangement'
import { formatTime } from '../lib/chart'
import type { SongMusic } from '../lib/sources'

/** A stem the blocks can mute (a combined stem such as Drums, or a stem on its own). */
export interface MutableStem {
  id: string
  name: string
}

interface Props {
  arr: Arrangement
  stems: MutableStem[]
  music: SongMusic | undefined
  /** index of the block playing now, -1 for none */
  current: number
  readOnly: boolean
  onChange: (arr: Arrangement) => void
  onPlayBlock: (index: number) => void
  /** splits the section under the playhead, if the playhead is in one */
  onSplitHere: () => void
  canSplit: boolean
}

const btn =
  'rounded-lg border border-slate-700 px-2 py-1 text-xs outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-teal-400 disabled:opacity-40'

/** The order of the song (blocks) and the pieces it is made of (sections). */
export function ArrEditor({ arr, stems, music, current, readOnly, onChange, onPlayBlock, onSplitHere, canSplit }: Props) {
  const [adding, setAdding] = useState(arr.sections[0]?.id ?? '')
  const sections = [...arr.sections].sort((a, b) => a.start - b.start)
  const label = (id: string) => arr.sections.find((s) => s.id === id)?.label ?? '?'

  const setBlocks = (blocks: Arrangement['blocks']) => onChange({ ...arr, blocks })
  const move = (i: number, by: number) => {
    const j = i + by
    if (j < 0 || j >= arr.blocks.length) return
    const blocks = [...arr.blocks]
    ;[blocks[i], blocks[j]] = [blocks[j], blocks[i]]
    setBlocks(blocks)
  }
  const toggle = (i: number, stem: string) =>
    setBlocks(arr.blocks.map((b, k) => (k === i ? { ...b, muted: b.muted.includes(stem) ? b.muted.filter((m) => m !== stem) : [...b.muted, stem] } : b)))

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section aria-labelledby="order-h">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 id="order-h" className="mr-auto text-sm font-semibold uppercase tracking-wide text-slate-400">
            Order
          </h2>
          {!readOnly && (
            <>
              <label className="sr-only" htmlFor="add-section">
                Section to add
              </label>
              <Select id="add-section" value={adding} onChange={(e) => setAdding(e.target.value)}>
                {sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
              <button type="button" className={btn} disabled={!adding} onClick={() => setBlocks([...arr.blocks, { id: newId(), section: adding, muted: [] }])}>
                + Add
              </button>
            </>
          )}
        </div>
        {arr.blocks.length === 0 && <p className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-400">No blocks. Add a section.</p>}
        <ol className="space-y-2">
          {arr.blocks.map((b, i) => (
            <li key={b.id} className={`rounded-xl border p-2 ${i === current ? 'border-teal-500/70 bg-teal-500/10' : 'border-slate-800 bg-slate-900/70'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-6 text-right text-xs tabular-nums text-slate-500">{i + 1}</span>
                <button type="button" onClick={() => onPlayBlock(i)} className="min-w-0 flex-1 truncate text-left text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-teal-400" aria-label={`Play from ${label(b.section)}`}>
                  ▶ {label(b.section)}
                </button>
                {!readOnly && (
                  <div className="flex gap-1">
                    <button type="button" className={btn} disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${label(b.section)} up`}>
                      ↑
                    </button>
                    <button type="button" className={btn} disabled={i === arr.blocks.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${label(b.section)} down`}>
                      ↓
                    </button>
                    <button
                      type="button"
                      className={btn}
                      onClick={() => setBlocks([...arr.blocks.slice(0, i + 1), { ...b, id: newId(), muted: [...b.muted] }, ...arr.blocks.slice(i + 1)])}
                      aria-label={`Repeat ${label(b.section)}`}
                    >
                      Repeat
                    </button>
                    <button type="button" className={btn} onClick={() => setBlocks(arr.blocks.filter((_, k) => k !== i))} aria-label={`Remove ${label(b.section)}`}>
                      Remove
                    </button>
                  </div>
                )}
              </div>
              <div role="group" aria-label={`Stems in ${label(b.section)}`} className="mt-2 flex flex-wrap gap-1 pl-8">
                {stems.map((s) => {
                  const on = !b.muted.includes(s.id)
                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={on}
                      disabled={readOnly}
                      onClick={() => toggle(i, s.id)}
                      className={`rounded-full px-2 py-0.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${on ? 'bg-slate-700 text-slate-100' : 'bg-slate-900 text-slate-500 line-through ring-1 ring-slate-800'}`}
                    >
                      {s.name}
                    </button>
                  )
                })}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="sections-h">
        <div className="mb-2 flex items-center gap-2">
          <h2 id="sections-h" className="mr-auto text-sm font-semibold uppercase tracking-wide text-slate-400">
            Sections
          </h2>
          {!readOnly && (
            <button type="button" className={btn} disabled={!canSplit} onClick={onSplitHere} title="Split the section at the playhead (on the nearest bar)">
              Split at playhead
            </button>
          )}
        </div>
        <ul className="space-y-1">
          {sections.map((s, i) => {
            const bars = barsIn(s, music)
            return (
              <li key={s.id} className="flex items-center gap-2 rounded-lg border border-slate-800 px-2 py-1">
                <label className="sr-only" htmlFor={`sec-${s.id}`}>
                  Name of the section at {formatTime(s.start)}
                </label>
                <input
                  id={`sec-${s.id}`}
                  value={s.label}
                  disabled={readOnly}
                  maxLength={40}
                  onChange={(e) => onChange({ ...arr, sections: arr.sections.map((x) => (x.id === s.id ? { ...x, label: e.target.value } : x)) })}
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
                />
                <span className="shrink-0 font-mono text-xs text-slate-500">
                  {formatTime(s.start)}
                  {bars !== null ? ` · ${bars} bars` : ''}
                </span>
                {!readOnly && i < sections.length - 1 && (
                  <button type="button" className={btn} onClick={() => onChange(joinWithNext(arr, s.id))} aria-label={`Join ${s.label} with the next section`} title="Join with the next section">
                    Join ↓
                  </button>
                )}
              </li>
            )
          })}
        </ul>
        <p className="mt-2 text-xs text-slate-500">Sections come from the chart's cues, on the nearest bar. Split and join to change them.</p>
      </section>
    </div>
  )
}
