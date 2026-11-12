import { Select } from './Select'
import { useEffect, useRef, useState } from 'react'
import { keyName, shiftKey, type Key } from '../lib/chords'
import { SCALES, type SongSettings, type ViewSettings } from '../lib/chart-view'

interface Props {
  /** the size Fit chose, so A− / A+ can step from it */
  fitScale: number
  view: ViewSettings
  song: SongSettings
  original: Key | null
  onView: (v: ViewSettings) => void
  onSong: (s: SongSettings) => void
}

const row = 'flex items-center justify-between gap-3 px-3 py-2'

function Segmented<T extends string | number | boolean>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="flex rounded-lg border border-slate-700 p-0.5">
      {options.map(([v, text]) => (
        <button
          key={String(v)}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`rounded-md px-2.5 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${value === v ? 'bg-teal-600 text-white' : 'text-slate-300'}`}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

/** The "View" button and its menu: key, capo, chords or numbers, columns, text size. */
export function ChartSettings({ fitScale, view, song, original, onView, onSong }: Props) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        button.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // A− / A+ step from the current size (Fit's when on Fit) to the next one in SCALES
  const current = view.scale === 'fit' ? fitScale : view.scale
  const smaller = [...SCALES].reverse().find((v) => v < current - 0.001)
  const larger = SCALES.find((v) => v > current + 0.001)
  // keys from 6 below to 5 above the original
  const shifts = Array.from({ length: 12 }, (_, i) => i - 6)
  const label = (n: number) => (original ? keyName(shiftKey(original, n)) : n > 0 ? `+${n}` : String(n))

  return (
    <div ref={box} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((o) => !o)}
        className="rounded-full border border-slate-700 px-3 py-1.5 text-sm outline-none hover:bg-slate-900 focus-visible:ring-2 focus-visible:ring-teal-400"
      >
        View
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-72 divide-y divide-slate-800 rounded-xl border border-slate-700 bg-slate-900 text-sm shadow-xl shadow-black/50">
          <label className={row}>
            <span>Key</span>
            <Select value={song.transpose} onChange={(e) => onSong({ ...song, transpose: Number(e.target.value) })}>
              {shifts.map((n) => (
                <option key={n} value={n}>
                  {label(n)}
                  {n === 0 ? ' (original)' : ''}
                </option>
              ))}
            </Select>
          </label>
          <label className={row}>
            <span>Capo</span>
            <Select value={song.capo} onChange={(e) => onSong({ ...song, capo: Number(e.target.value) })}>
              {Array.from({ length: 8 }, (_, c) => (
                <option key={c} value={c}>
                  {c === 0 ? 'None' : original ? `${c} (${keyName(shiftKey(original, song.transpose - c))} shapes)` : String(c)}
                </option>
              ))}
            </Select>
          </label>
          <div className={row}>
            <span>Chords</span>
            <Segmented
              label="Chord style"
              value={view.numbers && !!original}
              options={original ? [[false, 'Letters'], [true, 'Numbers']] : [[false, 'Letters']]}
              onChange={(numbers) => onView({ ...view, numbers })}
            />
          </div>
          <div className={row}>
            <span>Columns</span>
            <Segmented label="Columns" value={view.columns} options={[['auto', 'Auto'], [1, '1'], [2, '2']]} onChange={(columns) => onView({ ...view, columns })} />
          </div>
          <div className={row}>
            <span>Text size</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Smaller text"
                disabled={smaller === undefined}
                onClick={() => smaller !== undefined && onView({ ...view, scale: smaller })}
                className="h-8 w-8 rounded-lg border border-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-teal-400 disabled:opacity-40"
              >
                A−
              </button>
              <span className="w-12 text-center tabular-nums text-slate-400">{Math.round(current * 100)}%</span>
              <button
                type="button"
                aria-label="Larger text"
                disabled={larger === undefined}
                onClick={() => larger !== undefined && onView({ ...view, scale: larger })}
                className="h-8 w-8 rounded-lg border border-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-teal-400 disabled:opacity-40"
              >
                A+
              </button>
              <button
                type="button"
                aria-pressed={view.scale === 'fit'}
                onClick={() => onView({ ...view, scale: 'fit' })}
                className={`ml-1 h-8 rounded-lg px-2 outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${view.scale === 'fit' ? 'bg-teal-600 text-white' : 'border border-slate-700'}`}
                title="The largest text that shows the whole chart at once"
              >
                Fit
              </button>
            </div>
          </div>
          <div className={row}>
            <span>Paper</span>
            <Segmented label="Paper" value={view.paper} options={[['light', 'Light'], ['dark', 'Dark']]} onChange={(paper) => onView({ ...view, paper })} />
          </div>
          {(song.transpose !== 0 || song.capo !== 0) && (
            <div className="px-3 py-2">
              <button type="button" onClick={() => onSong({ transpose: 0, capo: 0 })} className="text-teal-300 underline underline-offset-2">
                Back to the original key, no capo
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
