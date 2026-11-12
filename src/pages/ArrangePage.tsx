import { Select } from '../components/Select'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ArrEditor, type MutableStem } from '../components/ArrEditor'
import { ArrTimeline } from '../components/ArrTimeline'
import { SongPicker } from '../components/SongPicker'
import { AUTH_REQUIRED, SONGS_BASE_URL } from '../config'
import {
  blockStarts,
  checkArrangement,
  countIn,
  freshArrangement,
  newId,
  sectionsFrom,
  splitSection,
  timelineOf,
  type Arrangement,
} from '../lib/arrangement'
import { deleteArrangement, listArrangements, loadArrangement, saveArrangement, type ArrangementInfo } from '../lib/arrangements-api'
import { authClient } from '../lib/auth-client'
import { useChurch } from '../lib/church-context'
import { formatTime, parseChart } from '../lib/chart'
import { StemEngine, SupersededError, type ClickBeat, type StemInfo } from '../lib/engine'
import { families } from '../lib/mix'
import { useNowPlaying } from '../lib/now-playing-context'
import { fetchLibrary, sourcesFromSong, type LibrarySong, type SongMusic } from '../lib/sources'

type ClickMode = 'off' | 'count' | 'on'

function clickBeats(music: SongMusic | undefined): ClickBeat[] {
  if (!music) return []
  const accents = new Set(music.downbeats)
  return music.beats.map((t, i) => ({ t, accent: accents.has(i) }))
}

/**
 * Your own arrangement of a song: its sections in your order, repeated or cut, with stems muted
 * per section. It has its own player; playing here pauses Practice. See docs/arrangements.md.
 */
export default function ArrangePage() {
  const { getTransport } = useNowPlaying()
  const { data: session } = authClient.useSession()
  const user = session?.user as { id?: string } | undefined
  const me = AUTH_REQUIRED ? (user?.id ?? '') : 'dev'
  const church = useChurch()
  // may change anyone's arrangement (editors and up); everyone changes their own
  const admin = church.can({ arrangement: ['manage'] })

  const [library, setLibrary] = useState<LibrarySong[] | null>(null)
  const [songId, setSongId] = useState('')
  // the song lives in the address (?song=), so a refresh or a shared link keeps it
  const [params, setParams] = useSearchParams()
  const wanted = params.get('song') ?? ''
  const [stems, setStems] = useState<StemInfo[]>([])
  const [music, setMusic] = useState<SongMusic | undefined>(undefined)
  const [arr, setArr] = useState<Arrangement | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState<ArrangementInfo[]>([])
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [playing, setPlaying] = useState(false)
  const [pos, setPos] = useState(0)
  const [duration, setDuration] = useState(0)
  const [recording, setRecording] = useState(0)
  const [clickMode, setClickMode] = useState<ClickMode>('count')
  const engineRef = useRef<StemEngine | null>(null)
  const loadToken = useRef(0)

  useEffect(() => {
    if (!SONGS_BASE_URL) return
    fetchLibrary(SONGS_BASE_URL, church.id)
      .then((songs) => setLibrary(songs.filter((s) => s.stems !== false)))
      .catch(() => setLibrary([]))
  }, [church.id])

  // the player is this page's own; it stops when the page is left
  useEffect(
    () => () => {
      void engineRef.current?.dispose()
      engineRef.current = null
    },
    [],
  )
  const getEngine = () => {
    if (!engineRef.current) {
      const e = new StemEngine()
      e.onEnded = () => {
        setPlaying(false)
        setPos(0)
      }
      e.onError = (err) => setError(err instanceof Error ? err.message : 'Playback error.')
      e.onStemsChange = (infos) => setStems(infos)
      if (import.meta.env.DEV) (window as unknown as { __arrEngine: StemEngine }).__arrEngine = e
      engineRef.current = e
    }
    return engineRef.current
  }

  const refreshList = useCallback((song: string) => {
    listArrangements(song)
      .then(setSaved)
      .catch(() => setSaved([]))
  }, [])

  const openSong = async (id: string) => {
    const token = ++loadToken.current
    setSongId(id)
    if (id !== wanted) setParams({ song: id }, { replace: true })
    setError('')
    setStatus('')
    setArr(null)
    setStems([])
    setPlaying(false)
    setPos(0)
    setLoading('Loading the song…')
    try {
      const engine = getEngine()
      const r = await sourcesFromSong(SONGS_BASE_URL, id)
      const infos = await engine.load(r.sources)
      if (token !== loadToken.current) return
      // sections from the chart's cues, when it has some
      const chartText = await fetch(`${SONGS_BASE_URL}/${encodeURIComponent(id)}/chart.pro`)
        .then((res) => (res.ok ? res.text() : ''))
        .catch(() => '')
      if (token !== loadToken.current) return
      const chart = chartText.trim() ? parseChart(chartText) : null
      setStems(infos)
      setRecording(engine.recordingDuration)
      setMusic(r.music)
      setArr(freshArrangement(id, me, sectionsFrom(chart?.sections ?? null, r.music, engine.recordingDuration)))
      setDirty(false)
      refreshList(id)
    } catch (e) {
      if (e instanceof SupersededError || token !== loadToken.current) return
      setError(e instanceof Error ? e.message : 'Could not load the song.')
    } finally {
      if (token === loadToken.current) setLoading(null)
    }
  }
  // opened with ?song= (a refresh, a link): open that song once the library is in
  useEffect(() => {
    if (!library || !wanted || wanted === songId || !library.some((s) => s.id === wanted)) return
    void openSong(wanted)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the address or library changes
  }, [library, wanted])


  // what each block can mute: combined stems and stems on their own (not the parts)
  const mutable: MutableStem[] = useMemo(() => {
    const parts = new Set(families(stems.map((s) => ({ group: s.group, mix: s.mix }))).flatMap((f) => f.children))
    return stems.filter((_, i) => !parts.has(i)).map((s) => ({ id: s.id, name: s.name }))
  }, [stems])
  const stemIds = useMemo(() => stems.map((s) => s.id), [stems])
  // the song's waveform (loudest of the main stems) and its bars, for the timeline
  const peaks = useMemo(() => {
    const parts = new Set(families(stems.map((s) => ({ group: s.group, mix: s.mix }))).flatMap((f) => f.children))
    const main = stems.filter((s, i) => !parts.has(i) && s.peaks.length > 0)
    if (main.length === 0) return []
    return main[0].peaks.map((_, i) => Math.min(1, Math.max(...main.map((s) => s.peaks[i] ?? 0))))
  }, [stems])
  const downbeats = useMemo(() => music?.downbeats.map((i) => music.beats[i]) ?? [], [music])

  // the player follows the arrangement and the click setting
  const { lead, beats: leadBeats } = useMemo(() => (arr ? countIn(arr, music) : { lead: 0, beats: [] }), [arr, music])
  const usedLead = clickMode === 'off' ? 0 : lead
  useEffect(() => {
    const engine = engineRef.current
    if (!engine || !arr || stemIds.length === 0) return
    engine.setTimeline(timelineOf(arr, stemIds), usedLead, leadBeats)
    engine.setBeats(clickMode === 'on' ? clickBeats(music) : [])
    engine.setClick(clickMode !== 'off', 0.8)
    setDuration(engine.duration)
    setPos(engine.position)
  }, [arr, stemIds, music, clickMode, usedLead, leadBeats])

  // playhead
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

  const togglePlay = async () => {
    const engine = engineRef.current
    if (!engine) return
    if (engine.isPlaying) {
      engine.pause()
      setPos(engine.position)
      setPlaying(false)
      return
    }
    getTransport()?.pause() // one sound at a time
    setPlaying(true)
    await engine.play()
  }
  const seek = async (t: number) => {
    const engine = engineRef.current
    if (!engine) return
    await engine.seek(t)
    setPos(engine.position)
  }

  const change = (next: Arrangement) => {
    setArr(next)
    setDirty(true)
    setStatus('')
  }

  // the block under the playhead
  const starts = arr ? blockStarts(arr, usedLead) : []
  const current = arr
    ? arr.blocks.findIndex((b, i) => {
        const s = arr.sections.find((x) => x.id === b.section)
        return s ? pos >= starts[i] && pos < starts[i] + (s.end - s.start) : false
      })
    : -1
  const splitHere = () => {
    if (!arr || current < 0) return
    const b = arr.blocks[current]
    const s = arr.sections.find((x) => x.id === b.section)
    if (s) change(splitSection(arr, s.id, s.start + (pos - starts[current]), music))
  }

  const readOnly = !!arr && arr.owner !== '' && arr.owner !== me && !admin
  const save = async (asNew = false) => {
    if (!arr) return
    setStatus('Saving…')
    setError('')
    try {
      const toSave = asNew ? { ...arr, id: newId(), owner: me, name: asNew && readOnly ? `${arr.name} (copy)` : arr.name } : arr
      const stored = await saveArrangement(toSave)
      setArr(stored)
      setDirty(false)
      setStatus('Saved')
      refreshList(arr.song)
    } catch (e) {
      setStatus('')
      setError(`Could not save: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  const openSaved = async (id: string) => {
    if (!songId) return
    if (dirty && !window.confirm('Leave this arrangement without saving it?')) return
    try {
      if (id === '') {
        setArr((a) => (a ? freshArrangement(songId, me, a.sections) : a))
      } else {
        const a = checkArrangement(await loadArrangement(songId, id))
        if (a) setArr(a)
      }
      setDirty(false)
      setStatus('')
      await seek(0)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const remove = async () => {
    if (!arr || !window.confirm(`Delete "${arr.name}"?`)) return
    try {
      await deleteArrangement(arr.song, arr.id)
      refreshList(arr.song)
      setArr(freshArrangement(arr.song, me, arr.sections))
      setDirty(false)
      setStatus('Deleted')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }
  const isSaved = !!arr && saved.some((s) => s.id === arr.id)

  const small =
    'rounded-full border border-slate-700 px-3 py-1.5 text-sm outline-none hover:bg-slate-900 focus-visible:ring-2 focus-visible:ring-teal-400 disabled:opacity-40'

  return (
    <div className="mx-auto max-w-5xl px-3 pb-24 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold tracking-tight">Arrange</h1>
        <SongPicker songs={library ?? []} value={songId} onPick={(id) => void openSong(id)} loading={library === null} className="w-full sm:w-80" />
      </div>

      {!songId && (
        <p className="mt-6 rounded-2xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">
          Choose a song to make your own arrangement of it: the sections in your order, repeated or left out, with stems muted where you want them.
        </p>
      )}
      {loading && <p className="mt-4 text-sm text-slate-400">{loading}</p>}
      {error && (
        <p role="alert" className="mt-3 rounded-lg bg-red-950 p-3 text-sm text-red-200">
          {error}
        </p>
      )}

      {arr && !loading && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="arr-open">
              Arrangement
            </label>
            <Select id="arr-open" value={isSaved ? arr.id : ''} onChange={(e) => void openSaved(e.target.value)}>
              <option value="">{isSaved ? 'New arrangement' : 'New arrangement (not saved)'}</option>
              {saved.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.ownerName && s.owner !== me ? ` · ${s.ownerName}` : ''}
                </option>
              ))}
            </Select>
            <label className="sr-only" htmlFor="arr-name">
              Name
            </label>
            <input
              id="arr-name"
              value={arr.name}
              maxLength={80}
              disabled={readOnly}
              onChange={(e) => change({ ...arr, name: e.target.value })}
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm"
            />
            {!readOnly && (
              <button type="button" className={`${small} border-teal-400/70 text-teal-200`} disabled={!dirty && isSaved} onClick={() => void save()}>
                Save
              </button>
            )}
            <button type="button" className={small} onClick={() => void save(true)}>
              {readOnly ? 'Save my copy' : 'Save as new'}
            </button>
            {isSaved && !readOnly && (
              <button type="button" className={small} onClick={() => void remove()}>
                Delete
              </button>
            )}
            <span role="status" className="text-xs text-slate-400">
              {status || (dirty ? 'Not saved' : '')}
              {readOnly ? 'Made by someone else: save your own copy to change it' : ''}
            </span>
          </div>

          <section aria-label="Player" className="mt-3 rounded-2xl border border-slate-800 bg-slate-900 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <button
                type="button"
                aria-label={playing ? 'Pause' : 'Play'}
                onClick={() => void togglePlay()}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-teal-600 text-lg"
              >
                {playing ? '❚❚' : '▶'}
              </button>
              <span className="font-mono text-sm tabular-nums text-slate-300">
                {formatTime(pos)} / {formatTime(duration)}
              </span>
              <div role="group" aria-label="Click" className="ml-auto flex rounded-lg border border-slate-700 p-0.5 text-xs">
                {(
                  [
                    ['off', 'No click'],
                    ['count', 'Count-in'],
                    ['on', 'Click'],
                  ] as const
                ).map(([m, text]) => (
                  <button key={m} type="button" aria-pressed={clickMode === m} onClick={() => setClickMode(m)} className={`rounded-md px-2 py-1 ${clickMode === m ? 'bg-teal-600 text-white' : 'text-slate-300'}`}>
                    {text}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-1 text-xs text-slate-400">
                Count-in
                <Select
                  compact
                  value={arr.countIn}
                  disabled={readOnly}
                  onChange={(e) => change({ ...arr, countIn: Number(e.target.value) })}
                >
                  {[0, 1, 2].map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? 'none' : `${n} bar${n > 1 ? 's' : ''}`}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            <ArrTimeline
              arr={arr}
              lead={usedLead}
              duration={duration}
              position={pos}
              onSeek={(t) => void seek(t)}
              peaks={peaks}
              recording={recording}
              downbeats={downbeats}
            />
            <p className="mt-1 text-xs text-slate-500">Tap the strip to put the playhead anywhere, then Split at playhead to cut a section there (on the nearest bar).</p>
          </section>

          <div className="mt-4">
            <ArrEditor
              arr={arr}
              stems={mutable}
              music={music}
              current={current}
              readOnly={readOnly}
              onChange={change}
              onPlayBlock={(i) => void seek(starts[i] ?? 0)}
              onSplitHere={splitHere}
              canSplit={current >= 0}
            />
          </div>
        </>
      )}
    </div>
  )
}
