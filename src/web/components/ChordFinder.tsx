import { useEffect, useRef, useState } from 'react'
import { PencilIcon, PlayIcon, PlusIcon, SquareIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { chordKeys, inversionsOf } from '../lib/chord-detect'
import { noteName, parseChord } from '../lib/chord-shapes'
import { cn } from '@/lib/utils'
import { Hint } from './Hint'
import { EditPopover } from './player/EditPopover'
import { Segmented } from './player/panels'
/** how long each chord sounds when played */
const HEAR_SECONDS = 1.6
const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th']
/** quick picks while the row has no chords of its own yet */
const COMMON = ['C', 'D', 'E', 'F', 'G', 'A', 'Am', 'Bm', 'Dm', 'Em', 'G/B', 'D/F#']
type Chord = { id: number; name: string; inversion: number }
/** The keys of a chord, or null when its name is not a chord this page knows. */
function keysOf(chord: Chord) {
  const inversion = Math.min(chord.inversion, inversionsOf(chord.name))
  const keys = chordKeys(chord.name, inversion)
  return keys && { ...keys, inversion, flats: parseChord(chord.name)?.flats ?? false }
}
/** "Em, 1st inversion" */
const labelOf = (name: string, inversion: number) => `${name}${inversion > 0 ? `, ${ORDINAL[inversion - 1]} inversion` : ''}`
/** a name typed with spaces or commas between chords is several chords */
const split = (text: string) => text.split(/[\s,]+/).filter(Boolean)
/**
 * A row of chords, as on a chord sheet: tap one to hear it and see its keys on the keyboard (`onShow`); the pencil
 * on the chord shown, or a double click, opens the same small editor as Practice's Chords view: the name, quick picks,
 * and its inversion. "+" adds chords (several at once when typed with spaces), Play all plays the row in order.
 * `press`/`release` sound and light keys through the page's keyboard.
 */
export function ChordFinder({ press, release, onShow }: { press: (pitch: number) => void; release: (pitch: number) => void; onShow: (shown: { keys: number[]; label: string } | null) => void }) {
  const [chords, setChords] = useState<Chord[]>([])
  const [shownId, setShownId] = useState<number | null>(null)
  // the chord being edited, 'new' for one being added
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [hearingId, setHearingId] = useState<number | null>(null)
  const nextId = useRef(1)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const sounding = useRef<number[]>([])
  const shown = chords.find((c) => c.id === shownId) ?? null
  const shownKeys = shown && keysOf(shown)
  const shownKeyList = shownKeys?.keys.join(',') ?? ''
  const shownLabel = shown && shownKeys ? labelOf(shown.name, shownKeys.inversion) : ''
  useEffect(() => {
    onShow(shownKeyList ? { keys: shownKeyList.split(',').map(Number), label: shownLabel } : null)
  }, [shownKeyList, shownLabel, onShow])
  const stop = () => {
    for (const t of timers.current) clearTimeout(t)
    timers.current = []
    for (const p of sounding.current) release(p)
    sounding.current = []
    setHearingId(null)
  }
  useEffect(() => () => {
    for (const t of timers.current) clearTimeout(t)
  }, [])
  /** Plays chords one after another, each shown on the keyboard as it sounds. */
  const hear = (list: Chord[]) => {
    stop()
    const playable = list.filter((c) => keysOf(c))
    playable.forEach((chord, k) => {
      timers.current.push(
        setTimeout(() => {
          for (const p of sounding.current) release(p)
          sounding.current = keysOf(chord)?.keys ?? []
          for (const p of sounding.current) press(p)
          setShownId(chord.id)
          setHearingId(chord.id)
        }, k * HEAR_SECONDS * 1000),
      )
    })
    if (playable.length) timers.current.push(setTimeout(stop, playable.length * HEAR_SECONDS * 1000 - 100))
  }
  const editingChord = typeof editing === 'number' ? chords.find((c) => c.id === editing) : undefined
  /** Saves the editor: a name (or several) for the chord edited, or new chords at the end. */
  const save = (text: string) => {
    const names = split(text)
    if (editing === 'new') {
      if (!names.length) return setEditing(null)
      const added = names.map((name) => ({ id: nextId.current++, name, inversion: 0 }))
      setChords((list) => [...list, ...added])
      setShownId(added[0].id)
      hear(added.slice(0, 1))
      // one chord added: the editor stays open on it, for its inversion; several: closed
      setEditing(added.length === 1 ? added[0].id : null)
      return
    }
    if (!editingChord) return setEditing(null)
    if (!names.length) return remove(editingChord.id)
    if (names.length === 1 && names[0] === editingChord.name) return setEditing(null)
    const [first, ...more] = names
    const extra = more.map((name) => ({ id: nextId.current++, name, inversion: 0 }))
    setChords((list) => list.flatMap((c) => (c.id === editingChord.id ? [{ ...c, name: first }, ...extra] : [c])))
    hear([{ ...editingChord, name: first }])
    if (extra.length) setEditing(null)
  }
  const remove = (id: number) => {
    stop()
    const at = chords.findIndex((c) => c.id === id)
    const rest = chords.filter((c) => c.id !== id)
    setChords(rest)
    setEditing(null)
    if (shownId === id) setShownId(rest[Math.max(0, at - 1)]?.id ?? null)
  }
  const setInversion = (id: number, inversion: number) => {
    const chord = chords.find((c) => c.id === id)
    if (!chord) return
    setChords((list) => list.map((c) => (c.id === id ? { ...c, inversion } : c)))
    hear([{ ...chord, inversion }])
  }
  const suggestions = [...new Set(chords.length ? chords.map((c) => c.name) : COMMON)]
  const known = chords.filter((c) => keysOf(c))
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {chords.map((chord) => {
          const keys = keysOf(chord)
          const isShown = chord.id === shownId
          return (
            <div key={chord.id} className="flex items-center">
              <button
                type="button"
                aria-label={keys ? `${labelOf(chord.name, keys.inversion)}: hear it` : `${chord.name}: not a chord name this page knows`}
                aria-pressed={isShown}
                onClick={() => (setShownId(chord.id), keys ? hear([chord]) : setEditing(chord.id))}
                onDoubleClick={() => setEditing(chord.id)}
                className={cn(
                  'flex h-10 min-w-12 items-start justify-center gap-0.5 rounded-md border-l-2 px-3 pt-1.5 text-lg font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  !keys ? 'border-destructive bg-destructive/10 text-destructive line-through' : isShown ? 'border-highlight/70 bg-primary text-white' : 'border-slate-500 bg-accent',
                  chord.id === hearingId && 'ring-2 ring-highlight/60',
                )}
              >
                {chord.name}
                {keys && keys.inversion > 0 && <sup className="mt-1 text-[10px] font-medium opacity-80">{ORDINAL[keys.inversion - 1]}</sup>}
              </button>
              {isShown && (
                <Hint text="Change this chord">
                  <Button type="button" variant="ghost" size="icon-sm" className="mobile:size-11" aria-label={`Change ${chord.name}`} onClick={() => setEditing(chord.id)}>
                    <PencilIcon />
                  </Button>
                </Hint>
              )}
            </div>
          )
        })}
        <Hint text="Add chords">
          <Button type="button" variant="outline" size={chords.length ? 'icon' : 'sm'} className={chords.length ? 'mobile:size-11' : ''} aria-label="Add chords" onClick={() => setEditing('new')}>
            <PlusIcon />
            {!chords.length && 'Add a chord'}
          </Button>
        </Hint>
        {known.length > 1 &&
          (hearingId !== null ? (
            <Button type="button" size="sm" className="ml-auto" onClick={stop}>
              <SquareIcon />
              Stop
            </Button>
          ) : (
            <Button type="button" size="sm" className="ml-auto" onClick={() => hear(chords)}>
              <PlayIcon />
              Play all
            </Button>
          ))}
      </div>
      {editing !== null && (
        <div className="max-w-md">
          <EditPopover
            key={`${editing}-${editingChord?.name ?? ''}`}
            title={editing === 'new' ? 'Add chords (several: put spaces between them)' : 'Chord'}
            initial={editingChord?.name ?? ''}
            placeholder="e.g. Dm7, G/B, Csus4"
            suggestions={suggestions}
            actions={editingChord ? [{ label: 'Remove', onClick: () => remove(editingChord.id) }] : []}
            onSave={save}
            onCancel={() => setEditing(null)}
          >
            {editingChord && <ChordDetails chord={editingChord} onInversion={(v) => setInversion(editingChord.id, v)} />}
          </EditPopover>
        </div>
      )}
    </div>
  )
}
/** In the editor: the chord's inversion and its notes. */
function ChordDetails({ chord, onInversion }: { chord: Chord; onInversion: (v: number) => void }) {
  const keys = keysOf(chord)
  if (!keys) return <p className="mt-2 text-xs text-destructive">Not a chord name this page knows.</p>
  const count = inversionsOf(chord.name)
  const options = (['Root', ...ORDINAL].slice(0, count + 1) as string[]).map((text, k): [string, string] => [String(k), text])
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <Segmented label="Inversion" size="sm" value={String(keys.inversion)} options={options} onChange={(v) => onInversion(Number(v))} />
      <span className="text-xs text-muted-foreground">
        {keys.bass !== null && (
          <>
            Left hand <span className="font-medium text-foreground">{noteName(keys.bass % 12, keys.flats)}</span>, right hand{' '}
          </>
        )}
        <span className="font-medium text-foreground">{keys.chord.map((p) => noteName(p % 12, keys.flats)).join(' ')}</span>
      </span>
    </div>
  )
}
