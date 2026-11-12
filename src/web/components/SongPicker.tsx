import { useId, useMemo, useRef, useState } from 'react'
import type { LibrarySong } from '../lib/sources'

interface Props {
  songs: LibrarySong[]
  value: string
  onPick: (id: string) => void
  /** shown while the library is loading */
  loading?: boolean
  className?: string
}

/** Lowercase without accents, so "diyos" finds "Diyos" and "cafe" finds "Café". */
const fold = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()

/**
 * A search box for the song library (ARIA combobox with a list). Shows the chosen song; type to
 * filter by any words of the title, arrows to move, Enter to pick, Esc to close.
 */
export function SongPicker({ songs, value, onPick, loading = false, className = '' }: Props) {
  const id = useId()
  const listId = `${id}-list`
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const selected = songs.find((s) => s.id === value)

  const matches = useMemo(() => {
    const words = fold(query).split(/\s+/).filter(Boolean)
    if (words.length === 0) return songs
    return songs.filter((s) => {
      const title = fold(s.title)
      return words.every((w) => title.includes(w))
    })
  }, [songs, query])

  const show = () => {
    setOpen(true)
    setQuery('')
    // start on the chosen song, so Enter keeps it
    setActive(Math.max(0, songs.findIndex((s) => s.id === value)))
  }
  const close = () => {
    setOpen(false)
    setQuery('')
  }
  const pick = (song: LibrarySong) => {
    close()
    input.current?.blur()
    if (song.id !== value) onPick(song.id)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return show()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (matches.length === 0 ? 0 : (i + step + matches.length) % matches.length))
    } else if (e.key === 'Enter' && open) {
      e.preventDefault()
      const song = matches[active]
      if (song) pick(song)
    } else if (e.key === 'Escape' && open) {
      e.preventDefault()
      close()
    }
  }

  const activeId = open && matches[active] ? `${id}-opt-${matches[active].id}` : undefined
  const placeholder = loading ? 'Loading songs…' : selected ? selected.title : 'Search songs'

  return (
    <div className={`relative ${className}`}>
      <div
        className={`flex items-center gap-2 rounded-xl border bg-card px-3 transition-colors focus-within:border-teal-400/70 focus-within:ring-2 focus-within:ring-ring/30 ${
          open ? 'border-teal-400/70' : 'border-border hover:border-input'
        }`}
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="size-4 shrink-0 text-muted-foreground">
          <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="2" />
          <path d="m14 14 4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-label="Song"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          autoComplete="off"
          spellCheck={false}
          disabled={loading && songs.length === 0}
          // closed: the chosen song's title; open: what you type, with the title as a hint
          value={open ? query : (selected?.title ?? '')}
          placeholder={placeholder}
          onFocus={show}
          onClick={() => !open && show()}
          onBlur={close}
          onChange={(e) => {
            if (!open) setOpen(true)
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <svg aria-hidden="true" viewBox="0 0 20 20" className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="m5 8 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Songs"
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-xl border border-border bg-card p-1 shadow-xl shadow-black/40"
        >
          {matches.length === 0 && <li className="px-3 py-2.5 text-sm text-muted-foreground">No songs match “{query}”</li>}
          {matches.map((song, i) => {
            const isActive = i === active
            const isSelected = song.id === value
            return (
              <li
                key={song.id}
                id={`${id}-opt-${song.id}`}
                role="option"
                aria-selected={isSelected}
                // keep focus in the input, so the blur does not close the list before the click
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(song)}
                onMouseMove={() => setActive(i)}
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2.5 text-sm ${isActive ? 'bg-accent text-white' : 'text-slate-300'}`}
              >
                <span className="min-w-0 flex-1 truncate">{song.title}</span>
                {song.stems === false && (
                  <span className="shrink-0 rounded-full border border-input px-2 py-0.5 text-xs text-muted-foreground">Chart only</span>
                )}
                {isSelected && (
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 shrink-0 text-teal-400">
                    <path d="m4 10 4 4 8-8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
