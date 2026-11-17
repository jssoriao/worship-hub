import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useIsMobileLayout } from '../../lib/layout-context'
import { Hint } from '../Hint'
import { MobileSheet } from '../MobileSheet'
import { formatClock as clock } from '../../lib/chart'
import { EditPopover } from './EditPopover'
import { Segmented } from './panels'
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
/** A lyric line as the Tap panel needs it: where it starts and its words. */
export interface TapLine {
  t: number
  words: string[]
}
/** Asks the Tap panel to open on Words at line `line` (from a line's edit box); `n` changes on each ask. */
export interface TapRequest {
  line: number
  n: number
}
interface Props {
  /** where the song is now, in seconds */
  position: number
  /** the song's lyric lines, in order */
  lines: TapLine[]
  /** all the lyrics as text, one line per row (for All lyrics) */
  text: string
  onAddLine: (t: number, text: string) => void
  /** replace all the lyrics with this text */
  onAllLyrics: (text: string) => void
  /** set where lines `from`, `from + 1`, ... start (and, when held, end) */
  onRetimeLines: (from: number, taps: Tap[]) => void
  /** set when the words of these lines start (and, when held, end) */
  onRetimeWords: (lines: { index: number; taps: Tap[] }[]) => void
  /** start the song playing from here */
  onPlayFrom: (t: number) => void
  onPause: () => void
  request?: TapRequest | null
}
/**
 * Edit mode of the Lyrics view: Add line (at the playhead), All lyrics (all the words in one box, to paste or change),
 * and Tap: time the lines there are, by line or by word, from a chosen line to the end in one pass.
 */
export function LyricTools({ position, lines, text, onAddLine, onAllLyrics, onRetimeLines, onRetimeWords, onPlayFrom, onPause, request }: Props) {
  const [mode, setMode] = useState<'add' | 'all' | 'tap' | null>(null)
  const [what, setWhat] = useState<'lines' | 'words'>('words')
  // the line Tap starts at when it opens (the playhead's line, or the line asked for)
  const [from, setFrom] = useState<number | null>(null)
  const close = () => setMode(null)
  // a new ask from a line's edit box opens Tap on its words (set while rendering: no extra pass)
  const [seen, setSeen] = useState(request)
  if (request !== seen) {
    setSeen(request)
    if (request) {
      setWhat('words')
      setFrom(request.line)
      setMode('tap')
    }
  }
  const none = lines.length === 0
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button type="button" variant="outline" size="sm" aria-pressed={mode === 'add'} onClick={() => setMode(mode === 'add' ? null : 'add')}>
          Add line
        </Button>
        <Button type="button" variant="outline" size="sm" aria-pressed={mode === 'all'} onClick={() => setMode('all')}>
          All lyrics
        </Button>
        <Hint text={none ? 'Add lyrics first' : undefined}>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={none}
            aria-pressed={mode === 'tap'}
            onClick={() => {
              setFrom(null)
              setMode(mode === 'tap' ? null : 'tap')
            }}
          >
            Tap
          </Button>
        </Hint>
      </div>
      {mode === 'add' && (
        <EditPopover
          title={`New line at ${clock(position)} (it moves to the nearest beat)`}
          initial=""
          placeholder="Words of the line"
          onSave={(t) => {
            onAddLine(position, t)
            close()
          }}
          onCancel={close}
        />
      )}
      {mode === 'all' && (
        <AllLyrics
          text={text}
          onApply={(t) => {
            onAllLyrics(t)
            close()
          }}
          onClose={close}
        />
      )}
      {mode === 'tap' && !none && (
        <div role="dialog" aria-label="Tap" className="w-[min(36rem,calc(100vw-2rem))] space-y-2 rounded-xl border border-primary/40 bg-card p-3 text-left shadow-xl shadow-black/50">
          <Segmented label="Tap" size="sm" value={what} options={[['words', 'Words'], ['lines', 'Lines']]} onChange={setWhat} />
          <RunTap
            key={`${what}:${from ?? ''}:${request?.n ?? 0}`}
            unit={what}
            position={position}
            lines={lines}
            initialFrom={from}
            onLines={onRetimeLines}
            onWords={onRetimeWords}
            onPlayFrom={onPlayFrom}
            onPause={onPause}
            onClose={close}
          />
        </div>
      )}
    </div>
  )
}
/** All the lyrics in one box: paste a whole song or change many lines at once. Apply puts it in the draft. */
function AllLyrics({ text, onApply, onClose }: { text: string; onApply: (text: string) => void; onClose: () => void }) {
  const mobile = useIsMobileLayout()
  // shown only while open, so each opening starts from the lyrics as they are now
  const open = true
  const [value, setValue] = useState(text)
  const rows = value.split('\n').filter((r) => r.trim()).length
  const body = (
    <div className="grid gap-3">
      <Textarea
        aria-label="All lyrics, one line per row"
        placeholder={'First line\nSecond line\n\nA blank row before a new section'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-[60dvh] resize-none font-[inherit] text-base leading-relaxed"
        autoFocus
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-xs text-muted-foreground">
          {rows} {rows === 1 ? 'line' : 'lines'} · changed lines keep a rough time, then Tap
        </span>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" size="sm" disabled={value === text} onClick={() => onApply(value)}>
          Apply
        </Button>
      </div>
    </div>
  )
  if (mobile)
    return (
      <MobileSheet open={open} onClose={onClose} title="All lyrics">
        {body}
      </MobileSheet>
    )
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>All lyrics</DialogTitle>
          <DialogDescription className="sr-only">One line per row; a blank row before a new section.</DialogDescription>
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  )
}
/** Tapping starts the song this long before the first line, to hear it coming. */
const TAP_LEAD_IN = 2
/** The line sounding at `t` (or the first one), as an index in `lines`. */
const lineAt = (lines: TapLine[], t: number) => Math.max(0, lines.findLastIndex((l) => l.t <= t + 0.1))
/**
 * Times the lines there are, from a chosen line to the end in one pass: press Start (the song plays from just before
 * it) and tap (the button or the space bar) as each line starts (`unit` lines) or each word (`unit` words), or hold
 * until it ends. Words run on into the next line. Backspace or Undo takes the last tap back; Done keeps them (what
 * was not tapped moves along or stays); the last tap ends it. Esc cancels.
 */
function RunTap({
  unit,
  position,
  lines,
  initialFrom,
  onLines,
  onWords,
  onPlayFrom,
  onPause,
  onClose,
}: {
  unit: 'lines' | 'words'
  position: number
  lines: TapLine[]
  initialFrom: number | null
  onLines: (from: number, taps: Tap[]) => void
  onWords: (lines: { index: number; taps: Tap[] }[]) => void
  onPlayFrom: (t: number) => void
  onPause: () => void
  onClose: () => void
}) {
  const [from, setFrom] = useState(() => Math.min(initialFrom ?? lineAt(lines, position), lines.length - 1))
  // what is tapped, in order: every word from the chosen line on, or every line
  const flat = useMemo(
    () => (unit === 'words' ? lines.slice(from).flatMap((l, j) => l.words.map((_, k) => ({ line: from + j, k }))) : lines.slice(from).map((_, j) => ({ line: from + j, k: 0 }))),
    [lines, from, unit],
  )
  const stop = () => {
    onPause()
    onClose()
  }
  const finish = (list: Tap[]) => {
    if (unit === 'lines') onLines(from, list)
    else {
      const byLine = new Map<number, Tap[]>()
      list.forEach((tap, n) => byLine.set(flat[n].line, [...(byLine.get(flat[n].line) ?? []), tap]))
      onWords([...byLine].map(([index, taps]) => ({ index, taps })))
    }
    stop()
  }
  const { taps, start: begin, holding, press, release, undo } = useHoldTap(position, flat.length, finish)
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
  // the line being tapped (the last one once all are tapped)
  const now = flat[Math.min(done, flat.length - 1)]?.line ?? from
  const offset = flat.findIndex((x) => x.line === now)
  return (
    <div className="space-y-2">
      {!running ? (
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="icon-sm" aria-label="Start a line earlier" disabled={from === 0} onClick={() => setFrom(from - 1)}>
            <ChevronLeftIcon />
          </Button>
          <p className="min-w-0 flex-1 truncate text-sm">
            <span className="text-muted-foreground">From {clock(lines[from].t)} · </span>
            {lines[from].words.join(' ')}
          </p>
          <Button type="button" variant="outline" size="icon-sm" aria-label="Start a line later" disabled={from === lines.length - 1} onClick={() => setFrom(from + 1)}>
            <ChevronRightIcon />
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {unit === 'words' ? 'Tap as each word starts' : 'Tap as each line starts'}, or hold until it ends (space bar). {done} of {flat.length}
        </p>
      )}
      {running && (
        <>
          {unit === 'words' ? (
            <p className="flex flex-wrap gap-x-2 gap-y-1 text-xl leading-snug">
              {lines[now].words.map((w, k) => {
                const n = offset + k
                return (
                  <span key={k} className={`inline-flex flex-col ${n === done ? 'text-white underline decoration-highlight decoration-2 underline-offset-4' : n < done ? 'text-highlight' : 'text-muted-foreground'}`}>
                    <span>{w}</span>
                    <span className="text-[11px] tabular-nums text-muted-foreground">{taps && n < done ? tapClock(taps[n]) : '\u00a0'}</span>
                  </span>
                )
              })}
            </p>
          ) : (
            <p className="text-2xl font-semibold leading-snug text-white">{lines[now].words.join(' ')}</p>
          )}
          {lines[now + 1] && <p className="truncate text-sm text-muted-foreground">{lines[now + 1].words.join(' ')}</p>}
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
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
          <Button
            type="button"
            size="sm"
            onClick={() => {
              begin()
              onPlayFrom(Math.max(0, lines[from].t - TAP_LEAD_IN))
            }}
          >
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
