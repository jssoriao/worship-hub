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
import { chordFromNotes, chordKeys, inversionsOf, prefersFlatsFor } from '../lib/chord-detect'
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
/** how long each chord sounds when the chords looked up are played */
const HEAR_SECONDS = 1.6
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
 * Everyone in the church. Play a MIDI keyboard (Web MIDI: Chrome, Edge, Firefox) and see its keys and the chord they
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
  // 0 = root position, 1 = 1st inversion, ...
  const [inversion, setInversion] = useState(0)
  // which of the chords looked up is shown, and the one sounding while they are played (null: none)
  const [step, setStep] = useState(0)
  const [hearing, setHearing] = useState<number | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const sounding = useRef<number[]>([])
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
  // the chords looked up (one, or several separated by spaces or commas), the one shown, and its keys
  const names = useMemo(() => lookup.split(/[\s,]+/).filter(Boolean), [lookup])
  const shownName = names[Math.min(step, names.length - 1)] ?? ''
  const unknown = names.filter((n) => chordKeys(n) === null)
  const inversions = Math.max(0, ...names.map(inversionsOf))
  const wanted = useMemo(() => (shownName ? chordKeys(shownName, inversion) : null), [shownName, inversion])
  const target = useMemo(() => (wanted ? new Set(wanted.keys) : undefined), [wanted])
  const pcs = (list: number[]) => [...new Set(list.map((p) => p % 12))].sort().join(',')
  const hit = !!wanted && hearing === null && active.size > 0 && pcs([...active.keys()]) === pcs(wanted.keys) && Math.min(...active.keys()) % 12 === wanted.keys[0] % 12
  // spelled as typed: flats when the name has one (as the chord shapes in Practice do)
  const lookupFlats = parseChord(shownName)?.flats ?? false
  /** Lets go of the chord heard and cancels the ones still to come. */
  const stopHearing = () => {
    for (const t of timers.current) clearTimeout(t)
    timers.current = []
    for (const p of sounding.current) keyboard.releaseKey(p)
    sounding.current = []
    setHearing(null)
  }
  /** Plays chords `from`..`to` of the list, one after another (each held HEAR_SECONDS), showing each as it sounds. */
  const hear = (from: number, to: number) => {
    stopHearing()
    const list = names.slice(from, to + 1).map((n) => chordKeys(n, inversion))
    list.forEach((c, k) => {
      timers.current.push(
        setTimeout(() => {
          for (const p of sounding.current) keyboard.releaseKey(p)
          sounding.current = c?.keys ?? []
          for (const p of sounding.current) keyboard.press(p, 80)
          setStep(from + k)
          setHearing(from + k)
        }, k * HEAR_SECONDS * 1000),
      )
    })
    timers.current.push(setTimeout(stopHearing, list.length * HEAR_SECONDS * 1000 - 100))
  }
  useEffect(() => () => {
    for (const t of timers.current) clearTimeout(t)
  }, [])
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
            {hit && <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-300">That's {shownName}{inversion > 0 && inversions > 0 ? `, ${['1st', '2nd', '3rd', '4th', '5th'][Math.min(inversion, inversions) - 1]} inversion` : ''}</span>}
          </div>
          <div ref={keysBox} className="overflow-x-auto">
            <div className="min-w-[44rem]">
              <PianoKeys active={active} target={target} onPress={(p) => keyboard.press(p)} onRelease={(p) => keyboard.releaseKey(p)} />
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
              <Input
                value={lookup}
                onChange={(e) => {
                  stopHearing()
                  setStep(0)
                  setLookup(e.target.value)
                }}
                placeholder="e.g. Dm7, or G D/F# Em C"
                aria-label="Chord"
                className="h-9 min-w-0 flex-1"
              />
              <NativeSelect aria-label="Inversion" value={String(Math.min(inversion, inversions))} disabled={inversions === 0} onChange={(e) => setInversion(Number(e.target.value))} className="w-36">
                {['Root position', '1st inversion', '2nd inversion', '3rd inversion', '4th inversion', '5th inversion'].slice(0, Math.max(1, inversions + 1)).map((label, k) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </NativeSelect>
              {lookup && (
                <Button type="button" variant="ghost" size="icon" aria-label="Clear the chord" onClick={() => (stopHearing(), setLookup(''), setInversion(0), setStep(0))}>
                  <XIcon />
                </Button>
              )}
            </div>
            {names.length > 0 && unknown.length === 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {hearing !== null ? (
                  <Button type="button" size="sm" onClick={stopHearing}>
                    <PauseIcon />
                    Stop
                  </Button>
                ) : (
                  <Button type="button" size="sm" onClick={() => hear(names.length > 1 ? 0 : step, names.length - 1)}>
                    <PlayIcon />
                    {names.length > 1 ? 'Play all' : 'Play'}
                  </Button>
                )}
                {/* several chords: each one shows its keys and sounds when tapped */}
                {names.length > 1 &&
                  names.map((n, k) => (
                    <Button key={k} type="button" variant={k === step ? 'secondary' : 'ghost'} size="sm" aria-pressed={k === step} onClick={() => hear(k, k)}>
                      {n}
                    </Button>
                  ))}
              </div>
            )}
            {names.length > 0 &&
              (unknown.length === 0 && wanted ? (
                <p className="text-sm text-muted-foreground">
                  {wanted.bass !== null && (
                    <>
                      Left hand <span className="font-medium text-foreground">{noteName(wanted.bass % 12, lookupFlats)}</span>, right hand{' '}
                    </>
                  )}
                  <span className="font-medium text-foreground">{wanted.chord.map((k) => noteName(k % 12, lookupFlats)).join(' ')}</span>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">Not a chord name this page knows: {unknown.join(', ')}</p>
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
