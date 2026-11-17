import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { formatClock as clock } from '../../lib/chart'
import { EditPopover } from './EditPopover'
/** A tap lands a little after the singer starts, so the line is taken to start this much earlier (it then snaps to a beat). */
const TAP_LEAD = 0.12
/** Held at least this long (song time), a press also marks where the line or word ends: at the release. */
const HOLD_MIN = 0.25
/** One tap: where it starts, and where it ends when it was held. */
export interface Tap {
  t: number
  end?: number
}
/**
 * Tap or hold along with the song, `count` times. A press marks a start; let go after `HOLD_MIN` and the release marks
 * the end as well (a quick tap leaves the end to the next start). The space bar works like the button. `finish` gets
 * the taps after the last release (or Done).
 */
function useHoldTap(position: number, count: number, finish: (taps: Tap[]) => void) {
  const [taps, setTaps] = useState<Tap[] | null>(null)
  // the song time of the press being held, if one is
  const [held, setHeld] = useState<number | null>(null)
  const where = useRef(position)
  useEffect(() => {
    where.current = position
  }, [position])
  const press = () => {
    if (!taps || held !== null) return
    setHeld(where.current)
  }
  const release = () => {
    if (!taps || held === null) return
    const now = where.current
    const tap: Tap = { t: Math.max(0, held - TAP_LEAD) }
    if (now - held >= HOLD_MIN) tap.end = Math.max(tap.t, now - TAP_LEAD)
    setHeld(null)
    const next = [...taps, tap]
    if (next.length >= count) finish(next)
    else setTaps(next)
  }
  const undo = () => {
    if (held !== null) setHeld(null)
    else setTaps((t) => (t && t.length > 0 ? t.slice(0, -1) : t))
  }
  const keys = useRef({ press, release, undo })
  useEffect(() => {
    keys.current = { press, release, undo }
  })
  const running = taps !== null
  useEffect(() => {
    if (!running) return
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault()
        if (!e.repeat) keys.current.press()
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        keys.current.undo()
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      e.preventDefault()
      keys.current.release()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [running])
  return { taps, start: () => setTaps([]), holding: held !== null, press, release, undo }
}
/** The big Tap button: down marks a start, up (after a hold) an end. No long-press menu or scrolling on touch screens. */
function HoldButton({ holding, press, release }: { holding: boolean; press: () => void; release: () => void }) {
  return (
    <Button
      type="button"
      size="lg"
      className={`min-w-40 touch-none select-none ${holding ? 'ring-2 ring-highlight' : ''}`}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        press()
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      {holding ? 'Holding…' : 'Tap'}
    </Button>
  )
}
/** A tap's time, with how long it was held. */
const tapClock = (tap: Tap) => (tap.end !== undefined ? `${clock(tap.t)} +${(tap.end - tap.t).toFixed(1)}s` : clock(tap.t))
interface Props {
  /** where the song is now, in seconds */
  position: number
  onAddLine: (t: number, text: string) => void
  onAddLines: (items: { t: number; end?: number; text: string }[]) => void
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
 * Paste the lyrics, one line per row, press Start and tap (the button or the space bar) as each line begins, or hold
 * it until the line ends. Each tap fixes where that line starts (a hold also where it ends); its words are spread
 * over the line's time, to fix by ear.
 */
function TapSync({ position, onAddLines, onPlayFrom, onPause, onClose }: Omit<Props, 'onAddLine'> & { onClose: () => void }) {
  const [text, setText] = useState('')
  const lines = useMemo(() => text.split('\n').map((l) => l.trim()).filter(Boolean), [text])
  const finish = (list: Tap[]) => {
    onAddLines(list.map((tap, k) => ({ ...tap, text: lines[k] })))
    onPause()
    onClose()
  }
  // null while the lyrics are pasted; each line tapped so far once it runs
  const { taps, start, holding, press, release, undo } = useHoldTap(position, lines.length, finish)
  // Esc stops (and the page leaves the edit box alone, see role="dialog")
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onPause()
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onPause, onClose])
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
                start()
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
            Tap as the line begins, or hold until it ends (space bar). {taps.length} of {lines.length}
          </p>
          <p className="text-2xl font-semibold leading-snug text-white">{next}</p>
          {lines[taps.length + 1] && <p className="text-lg text-muted-foreground">{lines[taps.length + 1]}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <HoldButton holding={holding} press={press} release={release} />
            <Button type="button" variant="outline" size="sm" disabled={taps.length === 0 && !holding} onClick={undo}>
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
              {taps.map((tap, k) => (
                <li key={k} className="flex gap-2">
                  <span className="tabular-nums text-highlight">{tapClock(tap)}</span>
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
/** Tapping the words of a line starts the song this long before the line, to hear it coming. */
const WORD_TAP_LEAD_IN = 2
/**
 * Times the words of one line: press Start (the song plays from just before the line) and tap (the button or the
 * space bar) as each word is sung, or hold it until the word ends. Backspace or Undo takes the last tap back; the last word's tap, or Done, keeps
 * them (Done with only some words tapped moves the rest along with the last one).
 */
export function WordTap({
  words,
  lineStart,
  position,
  onApply,
  onPlayFrom,
  onPause,
  onClose,
}: {
  words: string[]
  /** where the line starts now, in seconds */
  lineStart: number
  position: number
  onApply: (taps: Tap[]) => void
  onPlayFrom: (t: number) => void
  onPause: () => void
  onClose: () => void
}) {
  const stop = () => {
    onPause()
    onClose()
  }
  const finish = (list: Tap[]) => {
    onApply(list)
    stop()
  }
  const { taps, start: begin, holding, press, release, undo } = useHoldTap(position, words.length, finish)
  const start = () => {
    begin()
    onPlayFrom(Math.max(0, lineStart - WORD_TAP_LEAD_IN))
  }
  const running = taps !== null
  const stopRef = useRef(stop)
  useEffect(() => {
    stopRef.current = stop
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      stopRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const done = taps?.length ?? 0
  return (
    <div role="dialog" aria-label="Tap the words" className="mt-1 rounded-xl border border-primary/40 bg-card p-3 shadow-xl shadow-black/50">
      <p className="text-xs text-muted-foreground">
        {running ? `Tap as each word starts, or hold until it ends (space bar). ${done} of ${words.length}` : `The song plays from ${clock(Math.max(0, lineStart - WORD_TAP_LEAD_IN))}.`}
      </p>
      <p className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xl leading-snug">
        {words.map((w, k) => (
          <span key={k} className={`inline-flex flex-col ${running && k === done ? 'text-white underline decoration-highlight decoration-2 underline-offset-4' : k < done ? 'text-highlight' : 'text-muted-foreground'}`}>
            <span>{w}</span>
            <span className="text-[11px] tabular-nums text-muted-foreground">{taps && k < done ? tapClock(taps[k]) : '\u00a0'}</span>
          </span>
        ))}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {running ? (
          <>
            <HoldButton holding={holding} press={press} release={release} />
            <Button type="button" variant="outline" size="sm" disabled={done === 0 && !holding} onClick={undo}>
              Undo
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={done === 0} onClick={() => finish(taps)}>
              Done
            </Button>
          </>
        ) : (
          <Button type="button" size="sm" onClick={start}>
            Start
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" onClick={stop}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
