import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { formatClock as clock } from '../../lib/chart'
import { EditPopover } from './EditPopover'
/** A tap lands a little after the singer starts, so the line is taken to start this much earlier (it then snaps to a beat). */
const TAP_LEAD = 0.12
interface Props {
  /** where the song is now, in seconds */
  position: number
  onAddLine: (t: number, text: string) => void
  onAddLines: (items: { t: number; text: string }[]) => void
  /** start the song playing from here */
  onPlayFrom: (t: number) => void
  onPause: () => void
}
/** Edit mode of the Lyrics view: add a line at the playhead, or paste the lyrics and tap along to time them. */
export function LyricTools({ position, onAddLine, onAddLines, onPlayFrom, onPause }: Props) {
  const [mode, setMode] = useState<'add' | 'tap' | null>(null)
  const close = () => setMode(null)
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setMode('add')}>
          Add line
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => setMode('tap')}>
          Tap to sync
        </Button>
      </div>
      {mode === 'add' && (
        <EditPopover
          title={`New line at ${clock(position)} (it moves to the nearest beat)`}
          initial=""
          placeholder="Words of the line"
          onSave={(text) => {
            onAddLine(position, text)
            close()
          }}
          onCancel={close}
        />
      )}
      {mode === 'tap' && <TapSync position={position} onAddLines={onAddLines} onPlayFrom={onPlayFrom} onPause={onPause} onClose={close} />}
    </div>
  )
}
/**
 * Paste the lyrics, one line per row, press Start and tap (the button or the space bar) as each line begins.
 * Each tap fixes where that line starts; its words are spread over the time to the next tap, to fix by ear.
 */
function TapSync({ position, onAddLines, onPlayFrom, onPause, onClose }: Omit<Props, 'onAddLine'> & { onClose: () => void }) {
  const [text, setText] = useState('')
  // null while the lyrics are pasted; the start of each line tapped so far once it runs
  const [taps, setTaps] = useState<number[] | null>(null)
  const lines = useMemo(() => text.split('\n').map((l) => l.trim()).filter(Boolean), [text])
  const where = useRef(position)
  useEffect(() => {
    where.current = position
  }, [position])
  const finish = (list: number[]) => {
    onAddLines(list.map((t, k) => ({ t, text: lines[k] })))
    onPause()
    onClose()
  }
  const tap = () => {
    if (!taps) return
    const next = [...taps, Math.max(0, where.current - TAP_LEAD)]
    if (next.length >= lines.length) finish(next)
    else setTaps(next)
  }
  const undo = () => setTaps((t) => (t && t.length > 0 ? t.slice(0, -1) : t))
  // keys while tapping: space taps, Backspace takes the last tap back. Esc stops (and the page leaves the edit box alone, see role="dialog")
  const keys = useRef({ tap, undo })
  useEffect(() => {
    keys.current = { tap, undo }
  })
  const running = taps !== null
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onPause()
        onClose()
      } else if (running && e.code === 'Space' && !e.repeat) {
        e.preventDefault()
        keys.current.tap()
      } else if (running && e.key === 'Backspace') {
        e.preventDefault()
        keys.current.undo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [running, onPause, onClose])
  const next = taps ? lines[taps.length] : undefined
  return (
    <div role="dialog" aria-label="Tap to sync" className="rounded-xl border border-primary/40 bg-card p-3 shadow-xl shadow-black/50">
      {!taps ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Paste the lyrics, one line per row. The song plays from where it is now.</p>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={'First line\nSecond line'} aria-label="Lyrics, one line per row" className="min-h-28" autoFocus />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={lines.length === 0}
              onClick={() => {
                setTaps([])
                onPlayFrom(Math.max(0, position))
              }}
            >
              Start
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <span className="text-xs text-muted-foreground">{lines.length} {lines.length === 1 ? 'line' : 'lines'}</span>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Tap as the line begins (space bar). {taps.length} of {lines.length}
          </p>
          <p className="text-2xl font-semibold leading-snug text-white">{next}</p>
          {lines[taps.length + 1] && <p className="text-lg text-muted-foreground">{lines[taps.length + 1]}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="lg" className="min-w-40" onClick={tap}>
              Tap
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={taps.length === 0} onClick={undo}>
              Undo
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={taps.length === 0} onClick={() => finish(taps)}>
              Done
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onPause()
                onClose()
              }}
            >
              Cancel
            </Button>
          </div>
          {taps.length > 0 && (
            <ol className="max-h-28 space-y-0.5 overflow-auto text-xs text-muted-foreground">
              {taps.map((t, k) => (
                <li key={k} className="flex gap-2">
                  <span className="tabular-nums text-highlight">{clock(t)}</span>
                  <span className="truncate">{lines[k]}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}
