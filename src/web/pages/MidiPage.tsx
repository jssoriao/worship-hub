import { useEffect, useMemo, useRef, useState } from 'react'
import { FolderOpenIcon, MinusIcon, PauseIcon, PlayIcon, PlusIcon, RotateCcwIcon, RotateCwIcon } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Hint } from '../components/Hint'
import { PageHeader } from '../components/PageHeader'
import { PianoKeys } from '../components/PianoKeys'
import { Range } from '../components/Range'
import { useSeekDrag } from '../components/player/use-seek-drag'
import { formatClock as clock } from '../lib/chart'
import { chordFromNotes, prefersFlatsFor } from '../lib/chord-detect'
import { MidiError, notesAt, parseMidi, type MidiSong } from '../lib/midi'
import { MidiPlayer } from '../lib/midi-player'
import { useNowPlaying } from '../lib/now-playing-context'
const SKIP = 5
const TEMPO_STEP = 0.05
const TEMPO_MIN = 0.5
const TEMPO_MAX = 1.5
/**
 * Owners only for now: open a MIDI file from this computer, hear it, and watch the keys it plays and the chord they
 * make. Nothing is uploaded; the file stays in the browser.
 */
export default function MidiPage() {
  const nowPlaying = useNowPlaying()
  const [player] = useState(() => new MidiPlayer())
  const [song, setSong] = useState<MidiSong | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [tempo, setTempo] = useState(1)
  const fileInput = useRef<HTMLInputElement>(null)
  // on a narrow screen the keyboard scrolls: start it at the middle of the keys
  const keysBox = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = keysBox.current
    if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2
  }, [song])
  useEffect(() => {
    player.whenEnded(() => {
      setPlaying(false)
      setPos(player.position)
    })
    return () => {
      player.whenEnded(undefined)
      void player.dispose()
    }
  }, [player])
  // the playhead, while playing
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      setPos(player.position)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, player])
  const open = async (file: File) => {
    setError('')
    try {
      const parsed = parseMidi(await file.arrayBuffer())
      if (parsed.notes.length === 0) throw new MidiError('This MIDI file has no notes.')
      player.load(parsed)
      setSong(parsed)
      setName(file.name)
      setPlaying(false)
      setPos(0)
    } catch (e) {
      setError(e instanceof MidiError ? e.message : 'Could not read this file. Is it a MIDI file (.mid)?')
    }
  }
  const toggle = async () => {
    if (!song) return
    if (player.isPlaying) {
      player.pause()
      setPlaying(false)
      setPos(player.position)
      return
    }
    // one thing plays at a time: a song open in Practice stops
    nowPlaying.getTransport()?.pause()
    await player.play()
    setPlaying(true)
  }
  const seek = async (t: number) => {
    await player.seek(t)
    setPos(player.position)
  }
  const changeTempo = async (rate: number) => {
    const r = Math.round(Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, rate)) * 100) / 100
    await player.setTempo(r)
    setTempo(r)
  }
  // keys: space plays and pauses, the arrows skip (not while typing in a box)
  const keys = useRef({ toggle, seek })
  useEffect(() => {
    keys.current = { toggle, seek }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (!song || el?.closest('input, textarea, select, [contenteditable], [role=dialog]')) return
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault()
        void keys.current.toggle()
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        void keys.current.seek(player.position + (e.key === 'ArrowLeft' ? -SKIP : SKIP))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [song, player])
  const flats = useMemo(() => (song ? prefersFlatsFor(song.notes) : false), [song])
  const sounding = useMemo(() => (song ? notesAt(song.notes, pos) : []), [song, pos])
  const active = useMemo(() => new Map(sounding.map((n) => [n.pitch, n.velocity])), [sounding])
  const chord = useMemo(() => chordFromNotes(sounding.map((n) => n.pitch), flats), [sounding, flats])
  const seekDrag = useSeekDrag(pos, (t) => void seek(t))
  const duration = song?.duration ?? 0
  const openButton = (
    <Button type="button" variant={song ? 'outline' : 'default'} size="sm" onClick={() => fileInput.current?.click()}>
      <FolderOpenIcon />
      Open MIDI file
    </Button>
  )
  return (
    <div className="mx-auto max-w-6xl px-4 pt-3 pb-24 md:px-6">
      <PageHeader title="MIDI" actions={song ? openButton : undefined} />
      <input
        ref={fileInput}
        type="file"
        accept=".mid,.midi,audio/midi,audio/x-midi"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void open(file)
        }}
      />
      {error && (
        <Alert variant="destructive" className="mt-3">
          {error}
        </Alert>
      )}
      {!song ? (
        <Card className="surface-glass mx-auto mt-10 max-w-md items-center gap-3 p-8 text-center">
          <p className="text-sm text-muted-foreground">A .mid file from this computer. Nothing is uploaded.</p>
          {openButton}
        </Card>
      ) : (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="min-w-0 truncate text-base font-semibold">{name}</h2>
            <span className="text-xs text-muted-foreground">
              {song.notes.length} notes · {song.bpm} bpm{song.tempoChanges > 0 ? ' (changes)' : ''} · {clock(duration)}
            </span>
          </div>
          <Card className="surface-glass gap-3 p-3">
            <div className="flex h-12 items-center justify-center">
              <span aria-live="polite" aria-label={chord ? `Chord ${chord}` : 'No chord'} className={`text-4xl font-semibold tabular-nums ${chord ? 'text-highlight' : 'text-muted-foreground/50'}`}>
                {chord ?? '—'}
              </span>
            </div>
            <div ref={keysBox} className="overflow-x-auto">
              <div className="min-w-[44rem]">
                <PianoKeys active={active} />
              </div>
            </div>
          </Card>
          <Card className="surface-glass gap-2 p-3">
            <div className="flex items-center gap-2">
              <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{clock(seekDrag.shown)}</span>
              <Range max={Math.max(duration, 0.1)} step={0.1} value={Math.min(seekDrag.shown, duration)} aria-label="Position" aria-valuetext={`${clock(seekDrag.shown)} of ${clock(duration)}`} {...seekDrag.props} className="h-8 min-w-0 flex-1" />
              <span className="w-12 text-xs tabular-nums text-muted-foreground">{clock(duration)}</span>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
              <div className="flex items-center gap-2">
                <Hint text={`Back ${SKIP} seconds`}>
                  <Button type="button" variant="ghost" size="icon" className="mobile:size-11" aria-label={`Back ${SKIP} seconds`} onClick={() => void seek(player.position - SKIP)}>
                    <RotateCcwIcon />
                  </Button>
                </Hint>
                <Button type="button" size="icon-lg" className="bg-brand-gradient size-11 rounded-full" aria-label={playing ? 'Pause' : 'Play'} onClick={() => void toggle()}>
                  {playing ? <PauseIcon /> : <PlayIcon />}
                </Button>
                <Hint text={`Forward ${SKIP} seconds`}>
                  <Button type="button" variant="ghost" size="icon" className="mobile:size-11" aria-label={`Forward ${SKIP} seconds`} onClick={() => void seek(player.position + SKIP)}>
                    <RotateCwIcon />
                  </Button>
                </Hint>
              </div>
              <div role="group" aria-label="Tempo" className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Tempo</span>
                <Button type="button" variant="outline" size="icon-sm" className="mobile:size-11" aria-label="Slower" disabled={tempo <= TEMPO_MIN} onClick={() => void changeTempo(tempo - TEMPO_STEP)}>
                  <MinusIcon />
                </Button>
                <span className="w-12 text-center text-sm tabular-nums">{Math.round(tempo * 100)}%</span>
                <Button type="button" variant="outline" size="icon-sm" className="mobile:size-11" aria-label="Faster" disabled={tempo >= TEMPO_MAX} onClick={() => void changeTempo(tempo + TEMPO_STEP)}>
                  <PlusIcon />
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={tempo === 1} onClick={() => void changeTempo(1)}>
                  Reset
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
