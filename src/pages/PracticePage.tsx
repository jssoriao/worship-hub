import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { audioCache } from '../lib/audio-cache'
import { StemEngine, SupersededError, type ClickBeat, type DownloadProgress, type StemInfo } from '../lib/engine'
import { computeMix, families, type MixState } from '../lib/mix'
import { keyName, parseKey, shiftKey } from '../lib/chords'
import { MAX_KEY_SHIFT } from '../lib/key-shift'
import { loadSong as loadSongSettings, saveSong as saveSongSettings } from '../lib/chart-view'
import { describeMusic, fetchLibrary, sourcesFromSong, sourcesFromZip, type LibrarySong, type QualityTier, type SongMusic, type StemSource } from '../lib/sources'
import { SONGS_BASE_URL } from '../config'
import { useNowPlaying } from '../lib/now-playing-context'
import { StemRow } from '../components/StemRow'
import { SongPicker } from '../components/SongPicker'
import { Select } from '../components/Select'
import { Popover } from '../components/Popover'
import { TransportBar } from '../components/player/TransportBar'
import { ChordGrid } from '../components/player/ChordGrid'
import { LyricsView } from '../components/player/LyricsView'
import { ShapesView } from '../components/player/ShapesView'
import { StemTimeline, type TimelineStem } from '../components/player/StemTimeline'
import type { Instrument } from '../components/player/ChordShape'
import { fetchAnalysis, fetchAnalysisVersion, indexAt, transposeAnalysis, type ChordLevel, type SongAnalysis } from '../lib/analysis'
import { deleteLine, joinWithNextLine, listVersions, removeSectionAt, saveAnalysis, setChordAt, setLineText, setSectionAt, splitLine, type AnalysisVersion } from '../lib/analysis-edit'
import { resolveSongParam } from '../lib/address'
import { useChurch } from '../lib/church-context'

const defaultMix = (): MixState => ({ muted: false, solo: false, volume: 1 })

// Download qualities of a library song (see TIERS in dev/songs-plugin.ts).
const TIER_INFO: Record<string, { label: string; hint: string }> = {
  standard: { label: 'Standard', hint: 'Good quality, smaller download.' },
  saver: { label: 'Data saver', hint: 'Smallest download, slightly lower quality.' },
  original: { label: 'Original', hint: 'Full quality (256 kbps) and the largest download. For backing tracks.' },
}
const QUALITY_KEY = 'worship-hub:quality'
/** A key's name moved by some semitones ("A" +2 -> "B"); what it was when it is not a key. */
function shiftedKey(name: string, semitones: number): string {
  const k = parseKey(name)
  return k ? keyName(shiftKey(k, semitones)) : name
}

const CLICK_KEY = 'worship-hub:click'
const VIEW_KEY = 'worship-hub:practice-view'

type View = 'stems' | 'lyrics' | 'chords' | 'shapes'
interface ViewPrefs {
  view: View
  level: ChordLevel
  instrument: Instrument
  follow: boolean
}
function savedViewPrefs(): ViewPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as Partial<ViewPrefs> | null
    return {
      view: v?.view && ['stems', 'lyrics', 'chords', 'shapes'].includes(v.view) ? v.view : 'stems',
      level: v?.level && ['basic', 'simple', 'complex'].includes(v.level) ? v.level : 'simple',
      instrument: v?.instrument === 'piano' ? 'piano' : 'guitar',
      follow: v?.follow !== false,
    }
  } catch {
    return { view: 'stems', level: 'simple', instrument: 'guitar', follow: true }
  }
}

/** The click's settings on this device: off at first. */
/** The key this device last used for a song, as semitones from the recording (-6..+6). */
function savedKey(songId: string): number {
  const t = loadSongSettings(songId).transpose
  const wrapped = t > MAX_KEY_SHIFT ? t - 12 : t < -MAX_KEY_SHIFT ? t + 12 : t
  return Math.max(-MAX_KEY_SHIFT, Math.min(MAX_KEY_SHIFT, wrapped))
}

function savedClick(): { on: boolean; volume: number } {
  try {
    const raw = JSON.parse(localStorage.getItem(CLICK_KEY) ?? 'null') as { on?: unknown; volume?: unknown } | null
    const volume = typeof raw?.volume === 'number' && raw.volume >= 0 && raw.volume <= 1 ? raw.volume : 0.8
    return { on: raw?.on === true, volume }
  } catch {
    return { on: false, volume: 0.8 }
  }
}

/** The song's beats for the click, with the first beat of each bar accented. */
function clickBeats(music: SongMusic | undefined): ClickBeat[] {
  if (!music) return []
  const accents = new Set(music.downbeats)
  return music.beats.map((t, i) => ({ t, accent: accents.has(i) }))
}


/** A song's files on this device. `cached` of `urls.length` are saved; `pinned` means kept on purpose. */
interface OfflineStatus {
  group: string
  urls: string[]
  cached: number
  bytes: number
  pinned: boolean
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const megabytes = (bytes: number) => `${Math.round(bytes / 1048576)} MB`

/** The quality this device asked for last. With Data Saver on and no choice yet, the smallest one. */
function preferredTier(): string | undefined {
  try {
    const saved = localStorage.getItem(QUALITY_KEY)
    if (saved) return saved
  } catch {
    // storage blocked: fall through
  }
  return (navigator as { connection?: { saveData?: boolean } }).connection?.saveData ? 'saver' : undefined
}

/**
 * The stem player. The app keeps this page mounted while you look at other pages (see App.tsx), so
 * the song, the mix and the playback carry on while you read a chart.
 */
export default function PracticePage() {
  const nowPlaying = useNowPlaying()
  const engineRef = useRef<StemEngine | null>(null)
  const [stems, setStems] = useState<StemInfo[]>([])
  const [mix, setMix] = useState<MixState[]>([])
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [duration, setDuration] = useState(0)
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  /** this church's songs with stems; null until the list has loaded */
  const [libraryList, setLibraryList] = useState<LibrarySong[] | null>(null)
  const library = useMemo(() => libraryList ?? [], [libraryList])
  const [notInChurch, setNotInChurch] = useState(false)
  const [songId, setSongId] = useState('')
  const [tiers, setTiers] = useState<QualityTier[]>([])
  const [tier, setTier] = useState<string | null>(null)
  const [buffering, setBuffering] = useState(false)
  const [download, setDownload] = useState<DownloadProgress | null>(null)
  const [offline, setOffline] = useState<OfflineStatus | null>(null)
  const [saving, setSaving] = useState(false)
  const sourcesRef = useRef<StemSource[]>([])
  const [music, setMusic] = useState<SongMusic | undefined>(undefined)
  /** the music of the song being loaded, until it has loaded */
  const nextMusic = useRef<SongMusic | undefined>(undefined)
  const [click, setClick] = useState(savedClick)
  // the key the stems sound in, in semitones from the recording; remembered per song on this device
  const [key, setKey] = useState(0)
  const keyRef = useRef(0)
  // chords, beats, sections and timed lyrics, when the song has been analysed
  const [analysis, setAnalysis] = useState<SongAnalysis | null>(null)
  const [prefs, setPrefs] = useState<ViewPrefs>(savedViewPrefs)
  // editing (admins and the owner): changes collect in a draft until saved
  const church = useChurch()
  const mayEdit = church.can({ content: ['edit'] })
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<SongAnalysis | null>(null)
  const [editStatus, setEditStatus] = useState('')
  const [versions, setVersions] = useState<AnalysisVersion[] | null>(null)
  const shown = draft ?? analysis
  // what is read while playing: chords and key as they sound (editing shows the recording's own)
  const heard = useMemo(() => (shown && !editing ? transposeAnalysis(shown, key) : shown), [shown, editing, key])
  const change = (f: (a: SongAnalysis) => SongAnalysis) => {
    if (!shown) return
    setDraft(f(shown))
    setEditStatus('')
  }
  const stopEditing = () => {
    if (draft && !window.confirm('Discard your changes?')) return
    setDraft(null)
    setEditing(false)
    setVersions(null)
    setEditStatus('')
  }
  const saveDraft = async () => {
    if (!draft || !songId) return
    setEditStatus('Saving…')
    try {
      await saveAnalysis(songId, draft)
      setAnalysis(draft)
      setDraft(null)
      setEditStatus('Saved')
      setVersions(null)
    } catch (e) {
      setEditStatus(`Could not save: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const onLine = (index: number, text: string) =>
    change((a) => {
      const bar = text.indexOf('|')
      if (bar < 0) return setLineText(a, index, text)
      const before = text.slice(0, bar).trim().split(/\s+/).filter(Boolean).length
      return splitLine(setLineText(a, index, text.replace('|', ' ')), index, before)
    })
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(prefs))
    } catch {
      // storage blocked: not remembered
    }
  }, [prefs])

  /** What is saved on this device for the song that is open (null when it cannot be saved). */
  const refreshOffline = useCallback(() => {
    const sources = sourcesRef.current
    const urls = sources.flatMap((s) => (s.url && s.version ? [s.url] : []))
    const group = sources[0]?.cacheGroup
    // only songs whose files all have a fingerprint can be saved (an older manifest has none)
    if (!group || urls.length === 0 || urls.length !== sources.length) return setOffline(null)
    setOffline({ group, urls, ...audioCache.status(group, urls) })
  }, [])

  // one AudioContext for the app's lifetime (iOS limits how many you can create)
  const getEngine = () => {
    if (!engineRef.current) {
      const e = new StemEngine()
      e.onEnded = () => {
        setPlaying(false)
        setPos(0)
      }
      e.onError = (err) => setError(err instanceof Error ? err.message : 'Playback error.')
      // parts of combined stems download when first used
      e.onStemsChange = (infos) => {
        setStems(infos)
        setDuration(e.duration)
      }
      e.onBuffering = setBuffering
      e.onKeyError = () => {
        setKey(0)
        setError('Could not change the key on this device. Playing in the original key.')
      }
      e.onDownload = (d) => {
        setDownload(d)
        // finished files are saved a moment after they arrive
        if (d.active === 0) setTimeout(refreshOffline, 600)
      }
      engineRef.current = e
      if (import.meta.env.DEV) (window as unknown as { __engine: StemEngine }).__engine = e
    }
    return engineRef.current
  }

  useEffect(() => {
    if (!SONGS_BASE_URL) return
    fetchLibrary(SONGS_BASE_URL, church.id)
      .then((songs) => setLibraryList(songs.filter((s) => s.stems !== false)))
      .catch(() => setLibraryList([]))
  }, [church.id])

  // the click follows its settings, which this device remembers
  useEffect(() => {
    engineRef.current?.setClick(click.on, click.volume)
    try {
      localStorage.setItem(CLICK_KEY, JSON.stringify(click))
    } catch {
      // storage blocked: the setting just is not remembered
    }
  }, [click])

  // the key follows its setting, which this device remembers for each song
  useEffect(() => {
    keyRef.current = key
    engineRef.current?.setKey(key)
    if (songId) saveSongSettings(songId, { ...loadSongSettings(songId), transpose: key })
  }, [key, songId])

  // playhead ticker
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      setPos(engineRef.current?.position ?? 0)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  // tell the nav bar what is playing, so it can show a dot while you are on another page
  const { set: setNowPlaying, setTransport } = nowPlaying
  useEffect(() => {
    setNowPlaying({ title, songId, churchId: church.id, playing })
  }, [setNowPlaying, title, songId, church.id, playing])
  // let the charts follow the playhead and jump to a section
  useEffect(() => {
    setTransport({
      position: () => engineRef.current?.position ?? 0,
      seek: async (t) => {
        await engineRef.current?.seek(t)
        setPos(engineRef.current?.position ?? t)
      },
      pause: () => {
        const e = engineRef.current
        if (!e?.isPlaying) return
        e.pause()
        setPos(e.position)
        setPlaying(false)
      },
    })
    return () => setTransport(null)
  }, [setTransport])

  // ref mirrors state so rapid taps always build on the latest mix
  const mixRef = useRef<MixState[]>([])
  const updateMix = useCallback((next: MixState[]) => {
    mixRef.current = next
    setMix(next)
    engineRef.current?.applyMix(next)
  }, [])

  /** `restore` reloads the same song (another quality) and puts position, mix and playing back. */
  const loadSong = async (
    songTitle: string,
    getSources: () => Promise<StemSource[]>,
    restore?: { pos: number; playing: boolean; mix: MixState[] },
  ) => {
    setError(null)
    const engine = getEngine() // created inside the user gesture
    engine.setKey(keyRef.current)
    engine.unload()
    if (!restore) {
      setStems([])
      setPos(0)
    }
    setPlaying(false)
    setBuffering(false)
    setDownload(null)
    setLoading('Preparing…')
    try {
      const sources = await getSources()
      sourcesRef.current = sources
      refreshOffline()
      const infos = await engine.load(sources, (d, t, name) =>
        setLoading(name ? `Loading ${d}/${t}: ${name}` : null),
      )
      setStems(infos)
      setMusic(nextMusic.current)
      engine.setBeats(clickBeats(nextMusic.current))
      engine.setClick(click.on, click.volume)
      updateMix(restore && restore.mix.length === infos.length ? restore.mix : infos.map(defaultMix))
      setDuration(engine.duration)
      setTitle(songTitle)
      if (restore) {
        await engine.seek(restore.pos)
        setPos(engine.position)
        if (restore.playing) {
          setPlaying(true)
          await engine.play()
        }
      }
    } catch (e) {
      if (e instanceof SupersededError) return
      setError(e instanceof Error ? e.message : 'Failed to load song.')
    } finally {
      setLoading(null)
    }
  }

  // On this page the address is the only thing that chooses the song: /practice?song=<id> opens
  // that song, /practice opens none. Picking a song just changes the address (a new history entry,
  // so Back goes to the previous song). The nav bar links here with the song that is open, so
  // coming back from Charts keeps it; reloading or a shared link opens the same song.
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const onPracticePage = pathname === '/practice' || pathname.startsWith('/practice/')
  const wanted = new URLSearchParams(search).get('song') ?? ''
  const onFile = (file: File | undefined) => {
    if (!file) return
    // a zip is not a library song: the address has none (setSongId first, so that is not a "close")
    setSongId('')
    setKey(0)
    if (wanted) navigate('/practice')
    setTiers([])
    setTier(null)
    nextMusic.current = undefined
    setAnalysis(null)
    setDraft(null)
    setEditing(false)
    void loadSong(file.name.replace(/\.zip$/i, ''), () => sourcesFromZip(file))
  }

  /** Fetches the song's manifest for `wanted` quality and remembers which qualities it offers. */
  const librarySources = async (id: string, wanted?: string) => {
    const r = await sourcesFromSong(SONGS_BASE_URL, id, wanted)
    setTiers(r.tiers)
    setTier(r.tier)
    nextMusic.current = r.music
    return r.sources
  }

  /** Loads a library song. Only the address calls this (see below); picking a song changes the address. */
  const openSong = (id: string) => {
    const song = library.find((s) => s.id === id)
    if (!song) return
    setSongId(id)
    setKey(savedKey(id))
    setAnalysis(null)
    setDraft(null)
    setEditing(false)
    setVersions(null)
    void fetchAnalysis(song.id).then((a) => setAnalysis(a))
    void loadSong(song.title, () => librarySources(song.id, preferredTier()))
  }

  /** Closes the library song: nothing is open. */
  const closeSong = () => {
    engineRef.current?.unload()
    setSongId('')
    setKey(0)
    setStems([])
    setMix([])
    mixRef.current = []
    setPlaying(false)
    setPos(0)
    setDuration(0)
    setTitle('')
    setTiers([])
    setTier(null)
    setMusic(undefined)
    setAnalysis(null)
    setDraft(null)
    setEditing(false)
    setVersions(null)
    setLoading(null)
    setError(null)
    sourcesRef.current = []
    setOffline(null)
  }

  const pickSong = (id: string) => {
    if (id !== wanted) navigate(`/practice?song=${encodeURIComponent(id)}`)
  }
  useEffect(() => {
    if (!onPracticePage) {
      setNotInChurch(false)
      return
    }
    const target = resolveSongParam(wanted, libraryList)
    if (target.kind === 'open') {
      setNotInChurch(false)
      if (target.id !== songId) openSong(target.id)
    } else if (target.kind === 'unknown') {
      // an id from another church (or a stale link): say so and go to a clean /practice
      if (songId) closeSong()
      setNotInChurch(true)
      navigate('/practice', { replace: true })
    } else if (target.kind === 'none' && songId) {
      closeSong()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the address or the library changes
  }, [onPracticePage, wanted, libraryList])

  // switch quality: reload the same song at the same moment, with the same mix, and keep playing
  const onPickQuality = (id: string) => {
    const song = library.find((s) => s.id === songId)
    if (!song || id === tier) return
    try {
      localStorage.setItem(QUALITY_KEY, id)
    } catch {
      // storage blocked: the choice just is not remembered
    }
    const engine = engineRef.current
    const restore = engine && stems.length > 0 ? { pos: engine.position, playing: engine.isPlaying, mix: mixRef.current } : undefined
    void loadSong(song.title, () => librarySources(song.id, id), restore)
  }

  const togglePlay = async () => {
    const engine = engineRef.current
    if (!engine) return
    if (engine.isPlaying) {
      engine.pause()
      setPos(engine.position)
      setPlaying(false)
    } else {
      setPlaying(true)
      await engine.play()
    }
  }

  /** Downloads the whole song (every part) and keeps it on this device, ready to play with no connection. */
  const keepOffline = async () => {
    const engine = engineRef.current
    if (!engine || !offline) return
    setSaving(true)
    setError(null)
    try {
      await audioCache.pin(offline.group) // first, so no cleanup can take it while it downloads
      await engine.loadAll() // every part, completely; each finished file is saved as it lands
      for (let i = 0; i < 40; i++) {
        refreshOffline()
        if (audioCache.status(offline.group, offline.urls).cached === offline.urls.length) break
        await sleep(250)
      }
    } catch (e) {
      setError(`Could not save this song: ${e instanceof Error ? e.message : 'the download failed'}`)
    } finally {
      setSaving(false)
      refreshOffline()
    }
  }

  const removeOffline = async () => {
    if (!offline) return
    await audioCache.remove(offline.group)
    refreshOffline()
  }

  const seekTo = async (t: number) => {
    const engine = engineRef.current
    if (!engine) return
    await engine.seek(t)
    setPos(engine.position)
  }

  const seekFraction = async (f: number) => {
    const engine = engineRef.current
    if (!engine) return
    await engine.seek(f * duration)
    setPos(engine.position)
  }

  const patch = (i: number, p: Partial<MixState>) =>
    updateMix(mixRef.current.map((m, idx) => (idx === i ? { ...m, ...p } : m)))

  const anySolo = mix.some((m) => m.solo)
  const progress = duration > 0 ? pos / duration : 0

  // what is actually heard follows the same rules as the engine (see lib/mix.ts)
  const layout = useMemo(() => stems.map((s) => ({ group: s.group, mix: s.mix })), [stems])
  const family = useMemo(() => families(layout), [layout])
  const { gains, need } = useMemo(
    () => computeMix(layout, mix, stems.map((s) => s.loaded)),
    [layout, mix, stems],
  )

  // group stems by folder, preserving order
  const groups = useMemo(() => {
    const map = new Map<string, number[]>()
    stems.forEach((s, i) => map.set(s.group, [...(map.get(s.group) ?? []), i]))
    return [...map.entries()]
  }, [stems])

  // a part that is covered by its combined stem says so; downloading is shown on the waveform
  const noteFor = (i: number): string | undefined => {
    const f = family.find((fam) => fam.children.includes(i))
    if (f && gains[i] === 0 && gains[f.parent] > 0 && !mix[i]?.muted) return `Heard in ${stems[f.parent].name}`
    return undefined
  }

  // the timeline (wide screens): main stems as rows, parts of a combined stem under it
  const timeline = useMemo(() => {
    const byIndex = new Map<number, TimelineStem>()
    stems.forEach((stem, i) => {
      if (!mix[i]) return
      byIndex.set(i, { index: i, stem, mix: mix[i], audible: gains[i] > 0, waiting: need.includes(i), parts: family.find((f) => f.parent === i)?.children ?? [] })
    })
    const parts = new Set(family.flatMap((f) => f.children))
    const rows = groups.flatMap(([, idxs]) => idxs).filter((i) => !parts.has(i)).flatMap((i) => (byIndex.get(i) ? [byIndex.get(i)!] : []))
    return { rows, byIndex }
  }, [stems, mix, gains, need, family, groups])

  const renderRow = (i: number) => {
    const m = mix[i]
    if (!stems[i] || !m) return null
    return (
      <StemRow
        key={stems[i].id}
        stem={stems[i]}
        mix={m}
        audible={gains[i] > 0}
        waiting={need.includes(i)}
        note={noteFor(i)}
        combined={family.some((f) => f.parent === i)}
        part={family.some((f) => f.children.includes(i))}
        progress={progress}
        onSeek={seekFraction}
        onPatch={(p) => patch(i, p)}
      />
    )
  }

  const offlineDone = !!offline && offline.pinned && offline.cached === offline.urls.length
  const tierBytes = tiers.find((t) => t.id === tier)?.bytes
  const stemsView = prefs.view === 'stems' || !analysis
  const facts = [
    describeMusic(music && key !== 0 && music.key ? { ...music, key: shiftedKey(music.key, key) } : music),
    stems.length > 0 && `${stems.length} stems`,
    anySolo && 'solo active',
    playing && buffering && 'Buffering…',
    !saving && download && download.active > 0 && `Downloading ${Math.round(download.fraction * 100)}%`,
  ]
    .filter(Boolean)
    .join(' · ')
  const barStarts = useMemo(() => (shown ? shown.beats.filter((b) => b.n === 1) : []), [shown])
  const barLabel = barStarts.length > 0 ? `Bar ${Math.max(1, indexAt(barStarts, pos) + 1)} of ${barStarts.length}` : undefined

  const toggle = (on: boolean, onChange: (v: boolean) => void, label: string) => (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-teal-400 ${on ? 'bg-teal-500' : 'bg-slate-700'}`}
    >
      <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${on ? 'left-4.5' : 'left-0.5'}`} />
    </button>
  )
  const originalKey = parseKey(analysis?.key || music?.key || '')
  const canEditView = !!shown && mayEdit && (prefs.view === 'lyrics' || prefs.view === 'chords')
  const tools = (
    <>
      {music && music.beats.length > 0 && (
        <Popover
          label={click.on ? 'Click: on' : 'Click: off'}
          title="Click"
          active={click.on}
          button={
            <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
              <path d="M7.5 3h5l3.5 14H4z" />
              <path d="M10 13.5 14.5 6" />
              <path d="M6.5 13.5h7" />
            </svg>
          }
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 text-slate-300">
              <span>Play the click</span>
              {toggle(click.on, (on) => setClick((c) => ({ ...c, on })), 'Play the click')}
            </div>
            <label className="block text-slate-300">
              <span className="flex justify-between text-xs text-slate-400">
                <span>Volume</span>
                <span>{Math.round(click.volume * 100)}%</span>
              </span>
              <input type="range" min={0} max={1} step={0.01} value={click.volume} onChange={(e) => setClick((c) => ({ ...c, volume: Number(e.target.value) }))} className="mt-1 w-full accent-teal-500" />
            </label>
          </div>
        </Popover>
      )}
      {stems.length > 0 && (
        <Popover
          label={key === 0 ? 'Key: original' : `Key: ${key > 0 ? '+' : ''}${key} semitones`}
          title="Key"
          active={key !== 0}
          button={<span className="min-w-6 text-center text-sm font-medium tabular-nums">{key === 0 ? 'Key' : `${key > 0 ? '+' : ''}${key}`}</span>}
        >
          <div className="space-y-3 text-slate-300">
            <p className="text-xs text-slate-400">
              Move the whole song up or down to find a key the singer is comfortable in. The tempo stays the same and the chords follow.
            </p>
            <div className="flex items-center justify-between gap-2">
              <button type="button" aria-label="One semitone lower" disabled={key <= -MAX_KEY_SHIFT} onClick={() => setKey((k) => Math.max(-MAX_KEY_SHIFT, k - 1))} className="size-9 rounded-lg border border-slate-700 text-lg outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-teal-400 disabled:opacity-40">
                −
              </button>
              <div className="text-center" aria-live="polite">
                <div className="text-lg font-medium text-slate-100">{originalKey ? keyName(shiftKey(originalKey, key)) : `${key > 0 ? '+' : ''}${key}`}</div>
                <div className="text-xs text-slate-400">
                  {key === 0 ? 'Original key' : `${originalKey ? `from ${keyName(originalKey)}, ` : ''}${key > 0 ? '+' : ''}${key} semitone${Math.abs(key) === 1 ? '' : 's'}`}
                </div>
              </div>
              <button type="button" aria-label="One semitone higher" disabled={key >= MAX_KEY_SHIFT} onClick={() => setKey((k) => Math.min(MAX_KEY_SHIFT, k + 1))} className="size-9 rounded-lg border border-slate-700 text-lg outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-teal-400 disabled:opacity-40">
                +
              </button>
            </div>
            {key !== 0 && (
              <button type="button" onClick={() => setKey(0)} className="text-teal-300 underline underline-offset-2">
                Back to the original key
              </button>
            )}
            {editing && <p className="text-xs text-amber-300">Chords show the recording's own key while you edit.</p>}
          </div>
        </Popover>
      )}
      {shown && (
        <Popover
          label="View settings"
          title="View settings"
          button={
            <svg aria-hidden="true" viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
              <path d="M3 6h9M16 6h1M3 14h3M10 14h7" />
              <circle cx="14" cy="6" r="2" />
              <circle cx="8" cy="14" r="2" />
            </svg>
          }
        >
          <div className="space-y-3 text-slate-300">
            <div>
              <p className="mb-1 text-xs text-slate-400">Chord detail</p>
              <Segmented
                label="Chord detail"
                value={prefs.level}
                options={[
                  ['basic', 'Basic'],
                  ['simple', 'Simple'],
                  ['complex', 'Full'],
                ]}
                onChange={(level) => setPrefs((p) => ({ ...p, level }))}
              />
            </div>
            <div>
              <p className="mb-1 text-xs text-slate-400">Chord shapes for</p>
              <Segmented
                label="Instrument"
                value={prefs.instrument}
                options={[
                  ['guitar', 'Guitar'],
                  ['piano', 'Piano'],
                ]}
                onChange={(instrument) => setPrefs((p) => ({ ...p, instrument }))}
              />
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>
                Follow the song
                <span className="block text-xs text-slate-500">Lyrics and Chords scroll as it plays</span>
              </span>
              {toggle(prefs.follow, (follow) => setPrefs((p) => ({ ...p, follow })), 'Follow the song')}
            </div>
          </div>
        </Popover>
      )}
      {canEditView && !editing && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          title={prefs.view === 'chords' ? 'Fix chords and sections' : 'Fix the lyrics'}
          className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-slate-300 outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-teal-400"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
            <path d="M13.5 3.5l3 3L7 16H4v-3z" />
          </svg>
          Edit
        </button>
      )}
    </>
  )
  const small = 'rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-teal-400 disabled:opacity-50'
  // nothing chosen or loading: show only a centred search
  const blank = songId === '' && stems.length === 0 && !loading && !error

  const zipButton = (
    <label
      title="Play your own stems from a zip of mp3/wav files"
      className={`${small} inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap text-slate-300 focus-within:ring-2 focus-within:ring-teal-400`}
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H8l2 2h5.5A1.5 1.5 0 0 1 17 8.5v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 14.5z" />
      </svg>
      Open zip
      <input
        type="file"
        accept=".zip,application/zip"
        className="sr-only"
        onChange={(e) => {
          onFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </label>
  )

  return (
    <div className={`mx-auto max-w-7xl px-3 pt-2 ${stems.length === 0 ? 'pb-6' : stemsView ? 'pb-48 md:pb-40 lg:pb-24' : 'pb-48 md:pb-40'}`}>
        <h1 className="sr-only">Practice</h1>
        {notInChurch && wanted === '' && (
          <p role="alert" className="mt-2 rounded-lg bg-slate-900 p-3 text-sm text-slate-300">
            That song is not in this church.
          </p>
        )}
        {/* nothing open yet: just the search, centred, with the zip as a quiet alternative */}
        {blank && (
          <div className="mx-auto mt-[18vh] flex max-w-md flex-col items-center gap-3 text-center">
            <p className="text-lg font-medium text-slate-200">What are we practising?</p>
            {library.length > 0 && <SongPicker songs={library} value={songId} onPick={pickSong} className="w-full" />}
            <div className="flex items-center gap-2 text-xs text-slate-500">
              {library.length > 0 && <span>or</span>}
              {zipButton}
            </div>
          </div>
        )}

        {/* one row: the song, what it is, its quality, offline, another zip */}
        {!blank && (
        <div className="flex flex-wrap items-center gap-2">
          {library.length > 0 && <SongPicker songs={library} value={songId} onPick={pickSong} className="w-full min-w-0 sm:w-auto sm:flex-1 sm:max-w-sm" />}
          <div className="flex w-full items-center gap-1.5 sm:ml-auto sm:w-auto [&>*]:flex-1 sm:[&>*]:flex-none">
            {songId !== '' && tiers.length > 1 && (
              <>
                <label className="sr-only" htmlFor="quality">
                  Audio quality
                </label>
                <Select
                  compact
                  className="!flex-none whitespace-nowrap"
                  id="quality"
                  value={tier ?? ''}
                  disabled={loading !== null}
                  onChange={(e) => onPickQuality(e.target.value)}
                  title={tier ? TIER_INFO[tier]?.hint : undefined}
                >
                  {tiers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {TIER_INFO[t.id]?.label ?? t.id}
                      {t.bytes ? ` · ${Math.round(t.bytes / 1048576)} MB` : ''}
                    </option>
                  ))}
                </Select>
              </>
            )}
            {songId !== '' && offline && (
              <button
                type="button"
                disabled={saving || loading !== null}
                onClick={() => {
                  if (!offlineDone) return void keepOffline()
                  if (window.confirm(`Remove this song from the device? It frees ${megabytes(offline.bytes)}.`)) void removeOffline()
                }}
                title={
                  offlineDone
                    ? `Saved on this device (${megabytes(offline.bytes)}); plays with no connection. Tap to remove.`
                    : `Download the whole song${tierBytes ? ` (${megabytes(tierBytes)})` : ''} to play it with no connection.`
                }
                className={`${small} whitespace-nowrap ${offlineDone ? 'border-teal-700 text-teal-200' : ''}`}
              >
                {saving ? `Saving ${Math.round((download?.fraction ?? 0) * 100)}%` : offlineDone ? 'Offline ✓' : 'Save offline'}
              </button>
            )}
            {zipButton}
          </div>
        </div>
        )}

        {loading && <p className="mt-2 rounded-lg bg-slate-900 p-2 text-sm text-slate-300">{loading}</p>}
        {error && (
          <p role="alert" className="mt-2 rounded-lg bg-red-950 p-3 text-sm text-red-200">
            {error}
          </p>
        )}

        {stems.length > 0 && (
          <>
            {stemsView && (
              <div className="hidden lg:block">
                <StemTimeline
                  rows={timeline.rows}
                  byIndex={timeline.byIndex}
                  duration={duration}
                  position={pos}
                  onSeek={(t) => void seekTo(t)}
                  onPatch={patch}
                  analysis={heard}
                  level={prefs.level}
                  click={
                    music && music.beats.length > 0
                      ? {
                          on: click.on,
                          volume: click.volume,
                          onToggle: () => setClick((c) => ({ ...c, on: !c.on })),
                          onVolume: (v) => setClick((c) => ({ ...c, volume: v })),
                        }
                      : undefined
                  }
                />
              </div>
            )}
            {stemsView && (
              <div className="mx-auto mt-3 max-w-2xl space-y-3 lg:hidden">
                {groups.map(([group, idxs]) => {
                  // a group with a combined stem leads with that row, so it needs no heading of its own
                  const hasCombined = family.some((f) => idxs.includes(f.parent))
                  return (
                    <div key={group || 'root'}>
                      {group && !hasCombined && <h2 className="mb-1 px-1 text-xs uppercase tracking-wide text-slate-500">{group}</h2>}
                      <ul className="space-y-2">{idxs.map(renderRow)}</ul>
                    </div>
                  )
                })}
              </div>
            )}

            {shown && editing && (prefs.view === 'lyrics' || prefs.view === 'chords') && (
              <div className="mt-2 rounded-xl border border-teal-800 bg-teal-950/40 p-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mr-auto text-teal-200">
                    {prefs.view === 'chords' ? 'Tap a beat to set its chord, a bar number for its section.' : 'Tap a line to fix its words.'}
                  </span>
                  <button type="button" disabled={!draft} onClick={() => void saveDraft()} className="rounded-lg border border-teal-500 px-3 py-1 text-teal-100 disabled:opacity-40">
                    Save changes
                  </button>
                  <button type="button" disabled={!draft} onClick={() => (setDraft(null), setEditStatus(''))} className="rounded-lg border border-slate-600 px-3 py-1 disabled:opacity-40">
                    Discard changes
                  </button>
                  <button
                    type="button"
                    onClick={() => (versions ? setVersions(null) : void listVersions(songId).then(setVersions))}
                    aria-expanded={versions !== null}
                    className="rounded-lg border border-slate-600 px-3 py-1"
                  >
                    Versions
                  </button>
                  <button type="button" onClick={stopEditing} className="rounded-lg border border-slate-600 px-3 py-1">
                    Done
                  </button>
                </div>
                <p role="status" className="mt-1 text-xs text-slate-400">
                  {editStatus || (draft ? 'Not saved yet' : '')}
                </p>
                {versions && (
                  <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                    {versions.length === 0 && <li className="text-xs text-slate-400">No earlier versions yet: they are kept each time someone saves.</li>}
                    {versions.map((v) => (
                      <li key={v.file} className="flex items-center gap-2 text-xs">
                        <span className="flex-1 text-slate-300">
                          {new Date(v.savedAt).toLocaleString()} {v.savedBy && <span className="text-slate-500">· {v.savedBy}</span>}
                        </span>
                        <button
                          type="button"
                          aria-label={`Open the version of ${new Date(v.savedAt).toLocaleString()}`}
                          className="rounded border border-slate-600 px-2 py-0.5"
                          onClick={() =>
                            void fetchAnalysisVersion(songId, v.file).then((a) => {
                              if (!a) return setEditStatus('Could not open that version')
                              setDraft(a)
                              setEditStatus('An earlier version: Save to bring it back')
                            })
                          }
                        >
                          Open
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {heard && prefs.view === 'lyrics' && (
              <LyricsView
                analysis={heard}
                level={prefs.level}
                position={pos}
                onSeek={(t) => void seekTo(t)}
                follow={prefs.follow && playing && !editing}
                editing={editing}
                onLine={onLine}
                onDeleteLine={(i) => change((a) => deleteLine(a, i))}
                onJoinLine={(i) => change((a) => joinWithNextLine(a, i))}
              />
            )}
            {heard && prefs.view === 'chords' && (
              <ChordGrid
                analysis={heard}
                level={prefs.level}
                position={pos}
                onSeek={(t) => void seekTo(t)}
                follow={prefs.follow && playing && !editing}
                editing={editing}
                onChord={(t, name) => change((a) => setChordAt(a, t, name))}
                onSection={(t, label) => change((a) => (label === null ? removeSectionAt(a, t) : setSectionAt(a, t, label)))}
              />
            )}
            {heard && prefs.view === 'shapes' && <ShapesView analysis={heard} level={prefs.level} instrument={prefs.instrument} position={pos} onSeek={(t) => void seekTo(t)} />}

            <TransportBar
              title={title}
              facts={facts}
              playing={playing}
              buffering={buffering}
              position={pos}
              duration={duration}
              onToggle={() => void togglePlay()}
              onSeek={(t) => void seekTo(t)}
              bar={barLabel}
              view={analysis ? prefs.view : undefined}
              onView={(view) => setPrefs((p) => ({ ...p, view }))}
              tools={tools}
            />
          </>
        )}
    </div>
  )
}

function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="flex rounded-lg border border-slate-700 p-0.5">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`rounded-md px-2.5 py-1 outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${value === v ? 'bg-teal-600 text-white' : 'text-slate-300'}`}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
