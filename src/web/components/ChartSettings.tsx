import { useEffect, useRef, useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
    <div role="group" aria-label={label} className="flex rounded-lg border border-input p-0.5">
      {options.map(([v, text]) => (
        <button
          key={String(v)}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`rounded-md px-2.5 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${value === v ? 'bg-primary text-white' : 'text-slate-300'}`}
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
    // A Key or Capo list is drawn outside the panel (Radix portal). While one is open, Radix blocks the page
    // (a click lands on <html>, not on what is under the pointer) and closes the list itself on a click or
    // Esc; the panel stays open.
    const listOpen = () => document.querySelector('[data-slot=select-content]') !== null
    const onDown = (e: PointerEvent) => {
      if (!listOpen() && !box.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !listOpen()) {
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
        className="rounded-full border border-input px-3 py-1.5 text-sm outline-none hover:bg-card focus-visible:ring-2 focus-visible:ring-ring"
      >
        View
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-72 divide-y divide-border rounded-xl border border-input bg-card text-sm shadow-xl shadow-black/50">
          <div className={row}>
            <span>Key</span>
            <Select value={String(song.transpose)} onValueChange={(v) => onSong({ ...song, transpose: Number(v) })}>
              <SelectTrigger size="sm" aria-label="Key" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="end" className="max-h-72">
                {shifts.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {label(n)}
                    {n === 0 ? ' (original)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className={row}>
            <span>Capo</span>
            <Select value={String(song.capo)} onValueChange={(v) => onSong({ ...song, capo: Number(v) })}>
              <SelectTrigger size="sm" aria-label="Capo" className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" align="end">
                {Array.from({ length: 8 }, (_, c) => (
                  <SelectItem key={c} value={String(c)}>
                    {c === 0 ? 'None' : original ? `${c} (${keyName(shiftKey(original, song.transpose - c))} shapes)` : String(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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
                className="h-8 w-8 rounded-lg border border-input outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
              >
                A−
              </button>
              <span className="w-12 text-center tabular-nums text-muted-foreground">{Math.round(current * 100)}%</span>
              <button
                type="button"
                aria-label="Larger text"
                disabled={larger === undefined}
                onClick={() => larger !== undefined && onView({ ...view, scale: larger })}
                className="h-8 w-8 rounded-lg border border-input outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
              >
                A+
              </button>
              <button
                type="button"
                aria-pressed={view.scale === 'fit'}
                onClick={() => onView({ ...view, scale: 'fit' })}
                className={`ml-1 h-8 rounded-lg px-2 outline-none focus-visible:ring-2 focus-visible:ring-ring ${view.scale === 'fit' ? 'bg-primary text-white' : 'border border-input'}`}
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
              <button type="button" onClick={() => onSong({ transpose: 0, capo: 0 })} className="text-highlight underline underline-offset-2">
                Back to the original key, no capo
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
