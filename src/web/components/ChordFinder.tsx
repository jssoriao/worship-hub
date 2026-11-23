import { useEffect, useRef, useState } from 'react'
import { PlayIcon, PlusIcon, SquareIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { chordKeys, inversionsOf } from '../lib/chord-detect'
import { noteName, parseChord } from '../lib/chord-shapes'
import { cn } from '@/lib/utils'
/** how long each chord sounds when played */
const HEAR_SECONDS = 1.6
const INVERSIONS = ['Root position', '1st inversion', '2nd inversion', '3rd inversion', '4th inversion', '5th inversion']
const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th']
type Card = { id: number; name: string; inversion: number }
/** The chord a card stands for: its keys and how to read them, or null while its name is empty or not a chord. */
function keysOf(card: Card) {
  const name = card.name.trim()
  if (!name) return null
  const inversion = Math.min(card.inversion, inversionsOf(name))
  const keys = chordKeys(name, inversion)
  return keys && { ...keys, inversion, flats: parseChord(name)?.flats ?? false }
}
/** A chord's name with its inversion, as the page says it: "C/E, 1st inversion". */
const chordLabel = (name: string, inversion: number) => `${name}${inversion > 0 ? `, ${ORDINAL[inversion - 1]} inversion` : ''}`
/**
 * A row of chord cards: each has a chord name, its own inversion, ▶ to hear it and × to take it out. The card being
 * looked at (the last one touched or heard) is shown on the keyboard (`onShow`); Play all plays the row in order.
 * `press`/`release` sound and light keys through the page's keyboard.
 */
export function ChordFinder({ press, release, onShow }: { press: (pitch: number) => void; release: (pitch: number) => void; onShow: (shown: { keys: number[]; label: string } | null) => void }) {
  const [cards, setCards] = useState<Card[]>([{ id: 1, name: '', inversion: 0 }])
  const [shownId, setShownId] = useState(1)
  const [hearingId, setHearingId] = useState<number | null>(null)
  const nextId = useRef(2)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const sounding = useRef<number[]>([])
  const shown = cards.find((c) => c.id === shownId) ?? cards[0]
  const shownKeys = keysOf(shown)
  // tell the page what to mark on the keyboard
  const shownKeyList = shownKeys?.keys.join(',') ?? ''
  const shownLabel = shownKeys ? chordLabel(shown.name.trim(), shownKeys.inversion) : ''
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
  /** Plays the given cards one after another, each shown on the keyboard as it sounds. */
  const hear = (list: Card[]) => {
    stop()
    const playable = list.filter((c) => keysOf(c))
    playable.forEach((card, k) => {
      timers.current.push(
        setTimeout(() => {
          for (const p of sounding.current) release(p)
          sounding.current = keysOf(card)?.keys ?? []
          for (const p of sounding.current) press(p)
          setShownId(card.id)
          setHearingId(card.id)
        }, k * HEAR_SECONDS * 1000),
      )
    })
    if (playable.length) timers.current.push(setTimeout(stop, playable.length * HEAR_SECONDS * 1000 - 100))
  }
  const edit = (id: number, patch: Partial<Card>) => setCards((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)))
  const add = () => {
    const id = nextId.current++
    setCards((list) => [...list, { id, name: '', inversion: 0 }])
    setShownId(id)
    // the new card's name box takes the typing
    requestAnimationFrame(() => document.getElementById(`chord-${id}`)?.focus())
  }
  const remove = (id: number) => {
    stop()
    const at = cards.findIndex((c) => c.id === id)
    const rest = cards.filter((c) => c.id !== id)
    const next = rest.length ? rest : [{ id: nextId.current++, name: '', inversion: 0 }]
    setCards(next)
    if (shownId === id) setShownId(next[Math.max(0, at - 1)].id)
  }
  const known = cards.filter((c) => keysOf(c))
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {cards.map((card, k) => {
          const keys = keysOf(card)
          const inversions = card.name.trim() ? inversionsOf(card.name.trim()) : 0
          const name = card.name.trim()
          return (
            <div
              key={card.id}
              role="group"
              aria-label={`Chord ${k + 1}`}
              onFocusCapture={() => setShownId(card.id)}
              onPointerDown={() => setShownId(card.id)}
              className={cn(
                // two to a row on a phone, a fixed width on wider screens
                'w-[calc(50%-0.25rem)] space-y-1.5 rounded-lg border bg-background/40 p-2 transition-colors sm:w-44',
                card.id === shown.id ? 'border-primary/70' : 'border-border',
                card.id === hearingId && 'bg-primary/15',
              )}
            >
              <div className="flex items-center gap-1">
                <Input
                  id={`chord-${card.id}`}
                  value={card.name}
                  onChange={(e) => edit(card.id, { name: e.target.value })}
                  onKeyDown={(e) => {
                    // Enter: hear it; Enter on the last card with a chord in it: a new card after it
                    if (e.key !== 'Enter') return
                    e.preventDefault()
                    if (k === cards.length - 1 && keys) add()
                    else if (keys) hear([card])
                  }}
                  placeholder={k === 0 ? 'e.g. Dm7, G/B' : 'Chord'}
                  aria-label={`Chord ${k + 1} name`}
                  className="h-8 min-w-0 flex-1 px-2 font-semibold"
                />
                <Button type="button" variant="ghost" size="icon-sm" aria-label={`Hear ${name || `chord ${k + 1}`}`} disabled={!keys} onClick={() => hear([card])}>
                  <PlayIcon />
                </Button>
                {cards.length > 1 && (
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${name || `chord ${k + 1}`}`} onClick={() => remove(card.id)}>
                    <XIcon />
                  </Button>
                )}
              </div>
              <NativeSelect
                aria-label={`Inversion of ${name || `chord ${k + 1}`}`}
                value={String(Math.min(card.inversion, inversions))}
                disabled={!keys || inversions === 0}
                onChange={(e) => edit(card.id, { inversion: Number(e.target.value) })}
                size="sm"
                wrapperClassName="w-full"
                className="text-xs"
              >
                {INVERSIONS.slice(0, Math.max(1, inversions + 1)).map((label, i) => (
                  <option key={i} value={i}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
              <p className="min-h-4 truncate text-xs text-muted-foreground">
                {!name ? (
                  ' '
                ) : !keys ? (
                  <span className="text-destructive">Not a chord name this page knows</span>
                ) : (
                  <>
                    {keys.bass !== null && <span className="text-foreground/80">{noteName(keys.bass % 12, keys.flats)} | </span>}
                    <span className="font-medium text-foreground">{keys.chord.map((p) => noteName(p % 12, keys.flats)).join(' ')}</span>
                  </>
                )}
              </p>
            </div>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={add}>
          <PlusIcon />
          Add chord
        </Button>
        {hearingId !== null ? (
          <Button type="button" size="sm" onClick={stop}>
            <SquareIcon />
            Stop
          </Button>
        ) : (
          known.length > 1 && (
            <Button type="button" size="sm" onClick={() => hear(cards)}>
              <PlayIcon />
              Play all
            </Button>
          )
        )}
      </div>
    </div>
  )
}
