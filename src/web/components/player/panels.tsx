import type { ChordLevel } from '../../lib/analysis'
import { Range } from '../Range'
/**
 * The controls inside the play bar's panels: the click, tempo and key, and the view settings. Each is drawn once and
 * shown in a popover on desktop and in a bottom sheet on mobile, so the two layouts cannot drift apart.
 */

/** An on/off switch. */
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${on ? 'bg-primary' : 'bg-slate-700'}`}
    >
      <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${on ? 'left-4.5' : 'left-0.5'}`} />
    </button>
  )
}

/** A value with − and + on either side. A changed value is highlighted. */
export function Stepper(props: { label: string; value: string; changed: boolean; onLower: () => void; onHigher: () => void; lowerDisabled: boolean; higherDisabled: boolean }) {
  const { label, value, changed, onLower, onHigher, lowerDisabled, higherDisabled } = props
  const step = 'flex size-9 shrink-0 items-center justify-center rounded-lg border border-input text-lg outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 mobile:size-11'
  return (
    <div>
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      <div className="flex items-center gap-2">
        <button type="button" aria-label={`${label} lower`} disabled={lowerDisabled} onClick={onLower} className={step}>
          −
        </button>
        <output aria-live="polite" aria-label={label} className={`flex h-9 flex-1 items-center justify-center rounded-lg bg-background/60 text-base font-medium tabular-nums mobile:h-11 ${changed ? 'text-highlight' : 'text-foreground'}`}>
          {value}
        </output>
        <button type="button" aria-label={`${label} higher`} disabled={higherDisabled} onClick={onHigher} className={step}>
          +
        </button>
      </div>
    </div>
  )
}

/** A small set of choices, one picked. */
/** `size` sm: as tall as the small buttons beside it in a bar (a fixed size, not stretched on phones). */
export function Segmented<T extends string>({ label, value, options, onChange, size }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void; size?: 'sm' }) {
  return (
    <div role="group" aria-label={label} className={`flex rounded-lg border border-input p-0.5 ${size === 'sm' ? 'text-sm' : ''}`}>
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`rounded-md px-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring ${size === 'sm' ? 'h-7 mobile:h-10' : 'py-1 mobile:flex-1 mobile:py-2.5'} ${value === v ? 'bg-primary text-white' : 'text-slate-300'}`}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

/** The click: on or off, and how loud. */
export function ClickPanel({ on, volume, onOn, onVolume }: { on: boolean; volume: number; onOn: (on: boolean) => void; onVolume: (volume: number) => void }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 text-slate-300">
        <span>Play the click</span>
        <Toggle on={on} onChange={onOn} label="Play the click" />
      </div>
      <label className="block text-slate-300">
        <span className="flex justify-between text-xs text-muted-foreground">
          <span>Volume</span>
          <span>{Math.round(volume * 100)}%</span>
        </span>
        <Range max={1} step={0.01} value={volume} onChange={(e) => onVolume(Number(e.target.value))} className="mt-1 h-8 w-full" />
      </label>
    </div>
  )
}

/** Tempo and key, each with − and +, and Reset when either has moved. */
export function TempoKeyPanel(props: {
  tempoText: string
  tempoChanged: boolean
  onTempo: (direction: -1 | 1) => void
  tempoLowerDisabled: boolean
  tempoHigherDisabled: boolean
  keyText: string
  keyChanged: boolean
  onKey: (direction: -1 | 1) => void
  keyLowerDisabled: boolean
  keyHigherDisabled: boolean
  onReset: () => void
}) {
  return (
    <div className="space-y-3 text-slate-300">
      <Stepper label="Tempo" value={props.tempoText} changed={props.tempoChanged} onLower={() => props.onTempo(-1)} onHigher={() => props.onTempo(1)} lowerDisabled={props.tempoLowerDisabled} higherDisabled={props.tempoHigherDisabled} />
      <Stepper label="Key" value={props.keyText} changed={props.keyChanged} onLower={() => props.onKey(-1)} onHigher={() => props.onKey(1)} lowerDisabled={props.keyLowerDisabled} higherDisabled={props.keyHigherDisabled} />
      {(props.keyChanged || props.tempoChanged) && (
        <button type="button" onClick={props.onReset} className="text-xs text-highlight underline underline-offset-2 mobile:py-2 mobile:text-sm">
          Reset
        </button>
      )}
    </div>
  )
}

/** How chords and shapes are shown, and whether the view follows the song. */
export function ViewPanel(props: {
  level: ChordLevel
  onLevel: (level: ChordLevel) => void
  instrument: 'guitar' | 'piano'
  onInstrument: (instrument: 'guitar' | 'piano') => void
  follow: boolean
  onFollow: (follow: boolean) => void
  /** the Chords view shows the words sung in each beat */
  chordLyrics: boolean
  onChordLyrics: (on: boolean) => void
  /** chords as Nashville numbers; `canNumber` false when the song's key is not known (only letters then) */
  numbers: boolean
  onNumbers: (on: boolean) => void
  canNumber: boolean
}) {
  return (
    <div className="space-y-3 text-slate-300">
      <div>
        <p className="mb-1 text-xs text-muted-foreground">Chord detail</p>
        <Segmented
          label="Chord detail"
          value={props.level}
          options={[
            ['basic', 'Basic'],
            ['simple', 'Simple'],
            ['complex', 'Full'],
          ]}
          onChange={props.onLevel}
        />
      </div>
      <div>
        <p className="mb-1 text-xs text-muted-foreground">Chords as</p>
        <Segmented
          label="Chords as"
          value={props.numbers && props.canNumber ? 'numbers' : 'letters'}
          options={props.canNumber ? [['letters', 'Letters'], ['numbers', 'Numbers']] : [['letters', 'Letters']]}
          onChange={(v) => props.onNumbers(v === 'numbers')}
        />
      </div>
      <div>
        <p className="mb-1 text-xs text-muted-foreground">Chord shapes for</p>
        <Segmented
          label="Instrument"
          value={props.instrument}
          options={[
            ['guitar', 'Guitar'],
            ['piano', 'Piano'],
          ]}
          onChange={props.onInstrument}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <span>Follow the song</span>
        <Toggle on={props.follow} onChange={props.onFollow} label="Follow the song" />
      </div>
      <div className="flex items-center justify-between gap-3">
        <span>Lyrics in Chords</span>
        <Toggle on={props.chordLyrics} onChange={props.onChordLyrics} label="Lyrics in Chords" />
      </div>
    </div>
  )
}
