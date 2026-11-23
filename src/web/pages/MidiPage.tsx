import { useEffect, useMemo, useRef, useState } from 'react'
import { FolderOpenIcon, MinusIcon, PauseIcon, PianoIcon, PlayIcon, PlusIcon, RotateCcwIcon, RotateCwIcon, XIcon } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Hint } from '../components/Hint'
import { PageHeader } from '../components/PageHeader'
import { PianoKeys } from '../components/PianoKeys'
import { Range } from '../components/Range'
import { Toggle } from '../components/player/panels'
import { useSeekDrag } from '../components/player/use-seek-drag'
import { formatClock as clock } from '../lib/chart'
import { chordFromNotes, chordKeys, prefersFlatsFor } from '../lib/chord-detect'
import { noteName, parseChord } from '../lib/chord-shapes'
import { MidiError, notesAt, parseMidi, type MidiSong } from '../lib/midi'
import { LiveKeyboard, midiSupported, type InputDevice } from '../lib/midi-input'
import { MidiPlayer } from '../lib/midi-player'
import { useNowPlaying } from '../lib/now-playing-context'
import { Synth } from '../lib/synth'
const SKIP = 5
const TEMPO_STEP = 0.05
const TEMPO_MIN = 0.5
const TEMPO_MAX = 1.5
/** the keyboard settings, remembered on this device */
const SETTINGS = 'worship-hub.midi'
type Settings = { connect: boolean; device: string; sound: boolean; volume: number }
function loadSettings(): Settings {
  const plain: Settings = { connect: false, device: '', sound: true, volume: 0.8 }
  try {
    return { ...plain, ...(JSON.parse(localStorage.getItem(SETTINGS) ?? '{}') as Partial<Settings>) }
  } catch {
    return plain
  }
}
/**
 * Owners only for now. Play a MIDI keyboard (Web MIDI: Chrome, Edge, Firefox) and see its keys and the chord they
 * make, with the page's sound or with the sound muted (when a piano program or the keyboard itself plays). Look up a
 * chord to see which keys make it. Open a MIDI file from this computer and play it. Nothing is uploaded.
 * Playing the keyboard leaves a song in Practice playing, to play along; playing a file stops it.
 */
export default function MidiPage() {
  const nowPlaying = useNowPlaying()
  const [synth] = useState(() => new Synth())
  const [player] = useState(() => new MidiPlayer(synth))
  const [keyboard] = useState(() => new LiveKeyboard(synth))
  const [settings, setSettings] = useState(loadSettings)
  const [song, setSong] = useState<MidiSong | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [tempo, setTempo] = useState(1)
  // the keyboard: not asked yet / asked and refused / connected (with the keyboards plugged in)
  const [midi, setMidi] = useState<'idle' | 'asking' | 'denied' | 'on'>('idle')
  const [devices, setDevices] = useState<InputDevice[]>([])
  const [live, setLive] = useState<Map<number, number>>(new Map())
  const [lookup, setLookup] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)
  const keysBox = useRef<HTMLDivElement>(null)
  const change = (patch: Partial<Settings>) =>
    setSettings((s) => {
      const next = { ...s, ...patch }
      localStorage.setItem(SETTINGS, JSON.stringify(next))
      return next
    })
  useEffect(() => {
    player.whenEnded(() => {
      setPlaying(false)
      setPos(player.position)
    })
    keyboard.listen(
      () => setLive(keyboard.notes),
      (list) => setDevices(list),
    )
    return () => {
      player.whenEnded(undefined)
      keyboard.listen(undefined, undefined)
      player.dispose()
      keyboard.disconnect()
      void synth.close()
    }
  }, [player, keyboard, synth])
  useEffect(() => synth.setVolume(settings.volume), [settings.volume, synth])
  useEffect(() => keyboard.setSound(settings.sound), [settings.sound, keyboard])
  useEffect(() => keyboard.choose(settings.device), [settings.device, keyboard])
  const connect = async () => {
    // from a click, so the browser lets the page make sound
    await synth.resume()
    setMidi('asking')
    const state = await keyboard.connect()
    if (state.status === 'on') {
      setMidi('on')
      setDevices(state.devices)
      keyboard.choose(settings.device)
      if (!settings.connect) change({ connect: true })
    } else setMidi(state.status === 'denied' ? 'denied' : 'idle')
  }
  // connected before on this device: connect again (the browser remembers the permission)
  useEffect(() => {
    if (!settings.connect || !midiSupported()) return
    void keyboard.connect().then((state) => {
      if (state.status !== 'on') return
      setMidi('on')
      setDevices(state.devices)
    })
  }, [settings.connect, keyboard])
  // the playhead, while a file plays
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
  // on a narrow screen the keyboard scrolls: start it at the middle of the keys
  useEffect(() => {
    const el = keysBox.current
    if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2
  }, [])
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
    // a file and a song do not play together: a song open in Practice stops
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
  // keys: space plays and pauses the file, the arrows skip (not while typing in a box)
  const keys = useRef({ toggle, seek })
  useEffect(() => {
    keys.current = { toggle, seek }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (!song || el?.closest('input, textarea, select, button, [contenteditable], [role=dialog]')) return
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
  // what sounds: the file's notes at the playhead and the keys played on the keyboard
  const active = useMemo(() => {
    const out = new Map<number, number>()
    if (song) for (const n of notesAt(song.notes, pos)) out.set(n.pitch, n.velocity)
    for (const [p, v] of live) out.set(p, Math.max(v, out.get(p) ?? 0))
    return out
  }, [song, pos, live])
  const chord = useMemo(() => chordFromNotes([...active.keys()], flats), [active, flats])
  // the chord looked up: its keys, and whether they are what is being played
  const wanted = useMemo(() => (lookup.trim() ? chordKeys(lookup.trim()) : null), [lookup])
  const target = useMemo(() => (wanted ? new Set([wanted.bass, ...wanted.keys]) : undefined), [wanted])
  const pcs = (list: number[]) => [...new Set(list.map((p) => p % 12))].sort().join(',')
  const hit = !!wanted && active.size > 0 && pcs([...active.keys()]) === pcs([wanted.bass, ...wanted.keys]) && Math.min(...active.keys()) % 12 === wanted.bass % 12
  // spelled as typed: flats when the name has one (as the chord shapes in Practice do)
  const lookupFlats = parseChord(lookup.trim())?.flats ?? false
  const seekDrag = useSeekDrag(pos, (t) => void seek(t))
  const duration = song?.duration ?? 0
  return (
    <div className="mx-auto max-w-6xl px-4 pt-3 pb-24 md:px-6">
      <PageHeader
        title="MIDI"
        actions={
          <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
            <FolderOpenIcon />
            Open MIDI file
          </Button>
        }
      />
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
      <div className="mt-3 space-y-3">
        <Card className="surface-glass gap-3 p-3">
          <div className="flex h-12 items-center justify-center gap-3">
            <span aria-live="polite" aria-label={chord ? `Chord ${chord}` : 'No chord'} className={`text-4xl font-semibold tabular-nums ${chord ? 'text-highlight' : 'text-muted-foreground/50'}`}>
              {chord ?? '—'}
            </span>
            {hit && <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-300">That's {lookup.trim()}</span>}
          </div>
          <div ref={keysBox} className="overflow-x-auto">
            <div className="min-w-[44rem]">
              <PianoKeys active={active} target={target} />
            </div>
          </div>
        </Card>
        <div className="grid gap-3 md:grid-cols-2">
          <Card className="surface-glass gap-2 p-3">
            <h2 className="text-sm font-semibold">Keyboard</h2>
            {!midiSupported() ? (
              <p className="text-sm text-muted-foreground">This browser cannot read MIDI keyboards. Use Chrome or Edge.</p>
            ) : midi !== 'on' ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" disabled={midi === 'asking'} onClick={() => void connect()}>
                  <PianoIcon />
                  Connect keyboard
                </Button>
                {midi === 'asking' && <span className="text-xs text-muted-foreground">Allow MIDI devices in the browser's prompt.</span>}
                {midi === 'denied' && <span className="text-xs text-destructive">The browser was not allowed to use MIDI devices.</span>}
              </div>
            ) : (
              <div className="space-y-2">
                {devices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No keyboard found. Plug one in by USB.</p>
                ) : (
                  <NativeSelect aria-label="Keyboard" value={settings.device} onChange={(e) => change({ device: e.target.value })} className="w-full">
                    <option value="">Every keyboard ({devices.length})</option>
                    {devices.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </NativeSelect>
                )}
                <label className="flex items-center justify-between gap-2 text-sm">
                  <span>Sound from this page</span>
                  <Toggle on={settings.sound} onChange={(on) => change({ sound: on })} label="Sound from this page" />
                </label>
              </div>
            )}
            <label className="flex items-center gap-2 text-sm">
              <span className="w-14 text-muted-foreground">Volume</span>
              <Range max={1} step={0.05} value={settings.volume} aria-label="Volume" onChange={(e) => change({ volume: Number(e.target.value) })} className="h-8 min-w-0 flex-1" />
            </label>
          </Card>
          <Card className="surface-glass gap-2 p-3">
            <h2 className="text-sm font-semibold">Find a chord</h2>
            <div className="flex items-center gap-2">
              <Input value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="e.g. Dm7, G/B, Csus4" aria-label="Chord" className="h-9" />
              {lookup && (
                <Button type="button" variant="ghost" size="icon" aria-label="Clear the chord" onClick={() => setLookup('')}>
                  <XIcon />
                </Button>
              )}
            </div>
            {lookup.trim() &&
              (wanted ? (
                <p className="text-sm text-muted-foreground">
                  Bass <span className="font-medium text-foreground">{noteName(wanted.bass % 12, lookupFlats)}</span>, chord{' '}
                  <span className="font-medium text-foreground">{wanted.keys.map((k) => noteName(k % 12, lookupFlats)).join(' ')}</span>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">Not a chord name this page knows.</p>
              ))}
          </Card>
        </div>
        {song && (
          <Card className="surface-glass gap-2 p-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="min-w-0 truncate text-sm font-semibold">{name}</h2>
              <span className="text-xs text-muted-foreground">
                {song.notes.length} notes · {song.bpm} bpm{song.tempoChanges > 0 ? ' (changes)' : ''} · {clock(duration)}
              </span>
            </div>
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
        )}
      </div>
    </div>
  )
}
