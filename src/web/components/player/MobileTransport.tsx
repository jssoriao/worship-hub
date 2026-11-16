import { FileMusicIcon, GuitarIcon, MetronomeIcon, MicVocalIcon, PencilIcon, RotateCcwIcon, RotateCwIcon, Settings2Icon, SlidersHorizontalIcon, Grid2x2Icon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useChurch } from '../../lib/church-context'
import { practiceLink, useNowPlaying } from '../../lib/now-playing-context'
import { MobileSheet } from '../MobileSheet'
import { Range } from '../Range'
import { Toggle } from './panels'
import { useSeekDrag } from './use-seek-drag'
import type { PlayerView } from './TransportBar'

/** What the mobile layout shows instead of the desktop play bar's popovers (PracticePage builds it from the same panels). */
export interface MobileParts {
  /** the key as the key button shows it: "Db", or "E +3" when moved */
  keyText: string
  /** tempo or key has moved (the key button is tinted) */
  keyChanged: boolean
  /** the tempo and key panel, when a song is open with stems */
  tempoKey?: ReactNode
  /** the click panel, when the song has beats */
  click?: ReactNode
  clickOn: boolean
  /** the song's chart (a path), when it may be opened from here */
  chart?: string
  /** starts edit mode, when this person may edit what is on screen (Lyrics or Chords) */
  edit?: () => void
  /** the rest of the settings (view, quality, offline, edit, zip); `close` shuts the sheet */
  settings: (close: () => void) => ReactNode
}

interface Props {
  title: string
  playing: boolean
  buffering: boolean
  position: number
  duration: number
  onToggle: () => void
  onSeek: (seconds: number) => void
  loop: boolean
  onLoop: (loop: boolean) => void
  volume: number
  onVolume: (volume: number) => void
  view?: PlayerView
  onView?: (v: PlayerView) => void
  onPracticePage?: boolean
  mobile?: MobileParts
}

const VIEWS: [PlayerView, string, typeof SlidersHorizontalIcon][] = [
  ['stems', 'Stems', SlidersHorizontalIcon],
  ['lyrics', 'Lyrics', MicVocalIcon],
  ['chords', 'Chords', Grid2x2Icon],
  ['shapes', 'Shapes', GuitarIcon],
]
const SKIP = 5
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const round = 'grid size-11 shrink-0 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring'

/**
 * The play bar on a phone (and any mobile layout): the position with both times, then the controls one thumb can
 * reach, the views as a floating pill with the settings beside it. Tempo, key, click and everything else open as sheets
 * from the buttons here. Off the Practice page it is one slim row: the song and play.
 */
export function MobileTransport({ title, playing, buffering, position, duration, onToggle, onSeek, loop, onLoop, volume, onVolume, view, onView, onPracticePage = true, mobile }: Props) {
  const now = useNowPlaying()
  const church = useChurch()
  const [sheet, setSheet] = useState<'key' | 'click' | 'settings' | null>(null)
  const seekDrag = useSeekDrag(position, onSeek)
  const shownPos = Math.min(seekDrag.shown, duration)
  const close = () => setSheet(null)
  const playButton = (size: string) => (
    <button
      type="button"
      aria-label={playing ? 'Pause' : 'Play'}
      onClick={onToggle}
      className={`bg-brand-gradient ${size} grid shrink-0 place-items-center rounded-full text-primary-foreground shadow-[0_6px_18px_-6px_var(--brand)] outline-none focus-visible:ring-2 focus-visible:ring-ring`}
    >
      {playing && buffering ? (
        <span aria-hidden="true" className="size-5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
      ) : playing ? (
        <svg aria-hidden="true" viewBox="0 0 20 20" className="size-6" fill="currentColor">
          <path d="M5 4h3.5v12H5zM11.5 4H15v12h-3.5z" />
        </svg>
      ) : (
        <svg aria-hidden="true" viewBox="0 0 20 20" className="ml-0.5 size-6" fill="currentColor">
          <path d="M5 3.5v13l11-6.5z" />
        </svg>
      )}
    </button>
  )
  // a visible slider: the thumb is the finger's handle, the drag seeks when it is let go
  const seek = (
    <Range
      max={Math.max(duration, 0.1)}
      step={0.1}
      value={shownPos}
      aria-label="Position"
      aria-valuetext={`${fmt(shownPos)} of ${fmt(duration)}`}
      {...seekDrag.props}
      className="h-8 min-w-0 flex-1"
    />
  )

  if (!onPracticePage) {
    // another page: the song and play, nothing else
    return (
      <div role="region" aria-label="Playback" className="surface-glass border-x-0 border-b-0 border-t pb-safe">
        <div className="flex items-center gap-2 px-3 py-1.5">
          <Link to={practiceLink(now, church.id)} className="min-w-0 flex-1 truncate rounded-sm py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {title}
          </Link>
          {playButton('size-11')}
        </div>
      </div>
    )
  }

  return (
    <div className="relative">
      {/* the views and the settings float over the page just above the bar, taking no room of their own */}
      <div className="pointer-events-none absolute inset-x-0 bottom-full mb-2 flex flex-wrap items-center justify-center gap-1.5 px-2">
        {view && onView && (
          <nav aria-label="Views" className="surface-glass pointer-events-auto flex items-center gap-0.5 rounded-full border p-1">
            {VIEWS.map(([v, label, Icon]) => (
              <button
                key={v}
                type="button"
                aria-label={label}
                aria-pressed={view === v}
                onClick={() => onView(v)}
                // the active view is the gradient one; its name shows only where the row has room for it
                className={`flex h-11 items-center justify-center gap-1.5 rounded-full text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring ${view === v ? 'bg-brand-gradient w-11 text-primary-foreground min-[430px]:w-auto min-[430px]:px-3.5' : 'w-11 text-secondary-foreground'}`}
              >
                <Icon aria-hidden="true" className="size-5 shrink-0" />
                {view === v && <span className="hidden min-[430px]:inline">{label}</span>}
              </button>
            ))}
          </nav>
        )}
        {mobile?.edit && (
          <button type="button" aria-label="Edit" onClick={mobile.edit} className={`${round} surface-glass pointer-events-auto border text-secondary-foreground`}>
            <PencilIcon aria-hidden="true" className="size-5" />
          </button>
        )}
        {mobile?.chart && (
          <Link to={mobile.chart} aria-label="Chart" className={`${round} surface-glass pointer-events-auto border text-secondary-foreground`}>
            <FileMusicIcon aria-hidden="true" className="size-5" />
          </Link>
        )}
        <button type="button" aria-label="Settings" onClick={() => setSheet('settings')} className={`${round} surface-glass pointer-events-auto border text-secondary-foreground`}>
          <Settings2Icon aria-hidden="true" className="size-5" />
        </button>
      </div>

      <div role="region" aria-label="Playback" className="surface-glass border-x-0 border-b-0 border-t px-3 pt-2 pb-safe">
        <div className="flex items-center gap-2 text-xs tabular-nums text-muted-foreground">
          <span className="w-9 text-right">{fmt(shownPos)}</span>
          {seek}
          <span className="w-10">-{fmt(Math.max(0, duration - shownPos))}</span>
        </div>
        <div className="grid grid-cols-5 items-center justify-items-center pt-0.5 pb-2">
          {mobile?.click ? (
            <button type="button" aria-label="Click" aria-pressed={mobile.clickOn} onClick={() => setSheet('click')} className={`${round} ${mobile.clickOn ? 'bg-primary/20 text-highlight' : 'text-secondary-foreground'}`}>
              <MetronomeIcon aria-hidden="true" className="size-6" />
            </button>
          ) : (
            <span />
          )}
          <button type="button" aria-label={`Back ${SKIP} seconds`} onClick={() => onSeek(Math.max(0, position - SKIP))} className={`${round} text-secondary-foreground`}>
            <RotateCcwIcon aria-hidden="true" className="size-6" />
          </button>
          {playButton('size-14')}
          <button type="button" aria-label={`Forward ${SKIP} seconds`} onClick={() => onSeek(Math.min(duration, position + SKIP))} className={`${round} text-secondary-foreground`}>
            <RotateCwIcon aria-hidden="true" className="size-6" />
          </button>
          {mobile?.tempoKey ? (
            <button
              type="button"
              aria-label={`Tempo and key: ${mobile.keyText}`}
              onClick={() => setSheet('key')}
              className={`flex h-11 min-w-11 items-center justify-center rounded-full border px-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring ${mobile.keyChanged ? 'border-highlight/60 text-highlight' : 'border-input text-secondary-foreground'}`}
            >
              {mobile.keyText}
            </button>
          ) : (
            <span />
          )}
        </div>
      </div>

      <MobileSheet open={sheet === 'key'} onClose={close} title="Tempo & Key">
        {mobile?.tempoKey}
      </MobileSheet>
      <MobileSheet open={sheet === 'click'} onClose={close} title="Click">
        {mobile?.click}
      </MobileSheet>
      <MobileSheet open={sheet === 'settings'} onClose={close} title="Settings">
        <div className="space-y-5">
          <label className="block text-slate-300">
            <span className="flex justify-between text-xs text-muted-foreground">
              <span>Volume</span>
              <span>{Math.round(volume * 100)}%</span>
            </span>
            <Range max={1} step={0.01} value={volume} onChange={(e) => onVolume(Number(e.target.value))} className="mt-1 h-8 w-full" />
          </label>
          <div className="flex items-center justify-between gap-3 text-slate-300">
            <span>Repeat the song</span>
            <Toggle on={loop} onChange={onLoop} label="Repeat the song" />
          </div>
          {mobile?.settings(close)}
        </div>
      </MobileSheet>
    </div>
  )
}
