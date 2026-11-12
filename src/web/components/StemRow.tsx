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
}

export function StemRow({ stem, mix, audible, waiting, note, part, combined, progress, onSeek, onPatch }: Props) {
  return (
    <li
      className={`rounded-xl border p-2 ${part ? 'ml-4 border-slate-800/80 bg-slate-900/40' : combined ? 'border-teal-900 bg-slate-900' : 'border-slate-800 bg-slate-900/70'}`}
    >
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <span className={`block truncate text-sm ${combined ? 'font-semibold' : 'font-medium'} ${audible ? '' : 'text-slate-500'}`}>
            {stem.name}
          </span>
          {note && <span className="block truncate text-xs text-slate-500">{note}</span>}
        </div>
        <button
          aria-pressed={mix.muted}
          aria-label={`Mute ${stem.name}`}
          onClick={() => onPatch({ muted: !mix.muted })}
          className={`h-9 w-9 rounded-lg text-sm font-bold ${mix.muted ? 'bg-red-600 text-white' : 'bg-slate-800 text-slate-300'}`}
        >
          M
        </button>
        <button
          aria-pressed={mix.solo}
          aria-label={`Solo ${stem.name}`}
          onClick={() => onPatch({ solo: !mix.solo })}
          className={`h-9 w-9 rounded-lg text-sm font-bold ${mix.solo ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300'}`}
        >
          S
        </button>
      </div>
      <div className={`mt-2 ${waiting ? 'animate-pulse' : ''}`} aria-busy={waiting}>
        {stem.peaks.length > 0 ? (
          <Waveform peaks={stem.peaks} progress={progress} dim={!audible} onSeek={onSeek} />
        ) : (
          // no waveform known yet (a part that is not downloaded, in a song published without one)
          <div className="h-12 rounded-md bg-slate-800/40" aria-hidden="true" />
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
        className="mt-1 w-full accent-teal-500"
      />
    </li>
  )
}
