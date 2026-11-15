import type { StemInfo } from '../lib/engine'
import type { MixState } from '../lib/mix'
import { Waveform } from './Waveform'

interface Props {
  stem: StemInfo
  mix: MixState
  /** whether anything of this stem is heard right now */
  audible: boolean
  /** the person is waiting on this stem's download (background downloads stay quiet) */
  waiting?: boolean
  /** a short status under the name, e.g. "Heard in Drums" */
  note?: string
  /** a part of a combined stem */
  part?: boolean
  /** the combined stem of its group */
  combined?: boolean
  progress: number
  onSeek: (fraction: number) => void
  onPatch: (patch: Partial<MixState>) => void
  /**
   * The mobile layout's mixer row: the name, the volume and Mute / Solo on ONE line, so a whole song fits on a phone and
   * every stem can be muted with a thumb. A waveform joins the line only when the screen is wide enough for it (from 640 px).
   */
  compact?: boolean
}

export function StemRow({ stem, mix, audible, waiting, note, part, combined, progress, onSeek, onPatch, compact = false }: Props) {
  if (compact) {
    // the buttons are 44 px to hit, drawn smaller
    const toggle = 'grid size-11 shrink-0 place-items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring'
    const face = 'grid size-8 place-items-center rounded-lg text-sm font-bold'
    return (
      <li className="flex h-11 items-center gap-1.5 border-b border-border/40" aria-busy={waiting}>
        <span className={`w-28 shrink-0 truncate text-sm sm:w-36 ${part ? 'border-l border-border/60 pl-3' : ''} ${combined ? 'font-semibold' : 'font-medium'} ${audible ? '' : 'text-muted-foreground'} ${waiting ? 'animate-pulse' : ''}`}>
          {stem.name}
        </span>
        {stem.peaks.length > 0 && (
          <div className="hidden min-w-0 flex-1 sm:block">
            <Waveform peaks={stem.peaks} progress={progress} height={32} dim={!audible} onSeek={onSeek} />
          </div>
        )}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={mix.volume}
          aria-label={`Volume ${stem.name}`}
          onChange={(e) => onPatch({ volume: Number(e.target.value) })}
          className="h-8 min-w-0 flex-1 accent-primary sm:max-w-40"
        />
        <button type="button" aria-pressed={mix.muted} aria-label={`Mute ${stem.name}`} onClick={() => onPatch({ muted: !mix.muted })} className={toggle}>
          <span className={`${face} ${mix.muted ? 'bg-red-600 text-white' : 'bg-accent text-slate-300'}`}>M</span>
        </button>
        <button type="button" aria-pressed={mix.solo} aria-label={`Solo ${stem.name}`} onClick={() => onPatch({ solo: !mix.solo })} className={toggle}>
          <span className={`${face} ${mix.solo ? 'bg-amber-500 text-slate-950' : 'bg-accent text-slate-300'}`}>S</span>
        </button>
        {waiting && <span className="sr-only">Downloading {stem.name}</span>}
      </li>
    )
  }
  return (
    <li
      className={`rounded-xl border p-2 ${part ? 'ml-4 border-border/80 bg-card/40' : combined ? 'border-primary/40 bg-card' : 'border-border bg-card/70'}`}
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <span className={`block truncate text-sm ${combined ? 'font-semibold' : 'font-medium'} ${audible ? '' : 'text-muted-foreground'}`}>
            {stem.name}
          </span>
          {note && <span className="block truncate text-xs text-muted-foreground">{note}</span>}
        </div>
        <button
          aria-pressed={mix.muted}
          aria-label={`Mute ${stem.name}`}
          onClick={() => onPatch({ muted: !mix.muted })}
          className={`h-9 w-9 rounded-lg text-sm font-bold ${mix.muted ? 'bg-red-600 text-white' : 'bg-accent text-slate-300'}`}
        >
          M
        </button>
        <button
          aria-pressed={mix.solo}
          aria-label={`Solo ${stem.name}`}
          onClick={() => onPatch({ solo: !mix.solo })}
          className={`h-9 w-9 rounded-lg text-sm font-bold ${mix.solo ? 'bg-amber-500 text-slate-950' : 'bg-accent text-slate-300'}`}
        >
          S
        </button>
      </div>
      <div className={`mt-2 ${waiting ? 'animate-pulse' : ''}`} aria-busy={waiting}>
        {stem.peaks.length > 0 ? (
          <Waveform peaks={stem.peaks} progress={progress} dim={!audible} onSeek={onSeek} />
        ) : (
          // no waveform known yet (a part that is not downloaded, in a song published without one)
          <div className="h-12 rounded-md bg-accent/40" aria-hidden="true" />
        )}
        {waiting && <span className="sr-only">Downloading {stem.name}</span>}
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={mix.volume}
        aria-label={`Volume ${stem.name}`}
        onChange={(e) => onPatch({ volume: Number(e.target.value) })}
        className="mt-1 w-full accent-primary"
      />
    </li>
  )
}
