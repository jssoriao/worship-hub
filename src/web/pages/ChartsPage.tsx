import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import ChartEditor, { TEMPLATE } from '../components/ChartEditor'
import ChartPages from '../components/ChartPages'
import { SongPicker } from '../components/SongPicker'
import { SONGS_BASE_URL } from '../config'
import { resolveSongParam } from '../lib/address'
import { call, songFile, songsApi } from '../lib/api'
import { useChurch } from '../lib/church-context'
import { activeSection, parseChart } from '../lib/chart'
import { useNowPlaying } from '../lib/now-playing-context'
import { fetchLibrary, fetchSongMusic, type LibrarySong, type SongMusic } from '../lib/sources'

/** `text` is null when the song has no chart */
type Loaded = { id: string; text: string | null; error: string }

/** Chord charts. Follows the Practice page's playhead: highlights the current section and scrolls to it. */
export default function ChartsPage() {
  const now = useNowPlaying()
  const [library, setLibrary] = useState<LibrarySong[] | null>(null)
  // the picked song lives in the address (?song=), so a refresh or a shared link keeps it
  const [params, setParams] = useSearchParams()
  const picked = params.get('song') ?? ''
  const setPicked = (id: string) => setParams(id ? { song: id } : {}, { replace: true })
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [follow, setFollow] = useState(true)
  const [editing, setEditing] = useState(false)
  // editing and adding songs follow the person's permissions in this church
  const church = useChurch()
  const mayEdit = church.can({ content: ['edit'] })
  const mayAdd = church.can({ song: ['create'] })
  const [position, setPosition] = useState(-1)

  useEffect(() => {
    if (!SONGS_BASE_URL) return
    fetchLibrary(SONGS_BASE_URL, church.id)
      .then(setLibrary)
      .catch(() => setLibrary([]))
  }, [church.id])

  // the song that was picked, else the one that is playing
  // an address naming a song this church doesn't have opens nothing
  const unknownSong = resolveSongParam(picked, library).kind === 'unknown'
  const songId = unknownSong ? '' : picked || now.songId

  useEffect(() => {
    if (!songId) return
    const ctl = new AbortController()
    fetch(songFile(songId, 'chart.pro'), { signal: ctl.signal })
      .then(async (r) => {
        if (r.status === 404) return setLoaded({ id: songId, text: null, error: '' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        {
          const body = await r.text()
          setLoaded({ id: songId, text: body.trim() === '' ? null : body, error: '' })
        }
      })
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setLoaded({ id: songId, text: null, error: e instanceof Error ? e.message : String(e) })
      })
    return () => ctl.abort()
  }, [songId])

  const text = loaded?.id === songId ? loaded.text : null
  const chart = useMemo(() => (text === null ? null : parseChart(text)), [text])

  // the song's key and tempo from its stems' analysis; a {key} in the chart wins
  const [music, setMusic] = useState<{ id: string; music?: SongMusic }>({ id: '' })
  const hasStems = library?.find((s) => s.id === songId)?.stems !== false
  useEffect(() => {
    if (!songId || !hasStems) return
    let live = true
    fetchSongMusic(SONGS_BASE_URL, songId)
      .then((m) => live && setMusic({ id: songId, music: m }))
      .catch(() => live && setMusic({ id: songId }))
    return () => {
      live = false
    }
  }, [songId, hasStems])
  const songMusic = music.id === songId ? music.music : undefined
  const syncing = chart !== null && songId === now.songId
  const hasCues = chart?.sections.some((s) => s.t !== null) ?? false

  // read the playhead while the song plays (and once after a seek or pause)
  const { getTransport, playing } = now
  useEffect(() => {
    if (!chart || !syncing || !hasCues) return
    const read = () => setPosition(activeSection(chart.sections, getTransport()?.position() ?? 0))
    read()
    if (!playing) return
    let raf = 0
    const tick = () => {
      read()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [chart, syncing, hasCues, playing, getTransport])

  const active = chart && syncing && hasCues ? position : -1

  // leaving the song while editing would otherwise show the next song's chart in the editor
  const pick = (id: string) => {
    setEditing(false)
    setPicked(id)
  }

  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [addError, setAddError] = useState('')
  const addSong = async (e: React.FormEvent) => {
    e.preventDefault()
    setAddError('')
    try {
      const song = await call(songsApi.new.$post({ json: { title: newTitle } }))
      setLibrary((prev) => [...(prev ?? []), song].sort((a, b) => a.title.localeCompare(b.title)))
      setAdding(false)
      setNewTitle('')
      setPicked(song.id)
      setEditing(true)
    } catch (err) {
      setAddError(err instanceof Error ? err.message : String(err))
    }
  }

  const save = async (next: string) => {
    await call(
      songsApi[':songId']['chart.pro'].$put({ param: { songId } }, { init: { body: next, headers: { 'Content-Type': 'text/plain; charset=utf-8' } } }),
      { 403: 'you cannot edit charts here' },
    )
    setLoaded({ id: songId, text: next, error: '' })
    setEditing(false)
  }

  const jump = (t: number | null) => {
    if (t === null || !syncing || !chart) return
    // also when paused, when nothing else would refresh the highlight
    void getTransport()
      ?.seek(t)
      .then(() => setPosition(activeSection(chart.sections, t)))
  }

  return (
    <div className={`mx-auto px-3 pt-3 ${editing ? 'max-w-5xl pb-24' : 'max-w-6xl pb-2'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-semibold tracking-tight">Charts</h1>
        <SongPicker songs={library ?? []} value={songId} onPick={pick} loading={library === null} className="w-full sm:w-80" />
      {mayAdd && SONGS_BASE_URL && (
        <div className={adding ? 'w-full' : ''}>
          {adding ? (
            <form onSubmit={(e) => void addSong(e)} className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="new-song">
                Song title
              </label>
              <input
                id="new-song"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Song title"
                maxLength={120}
                autoFocus
                className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
              />
              <button type="submit" disabled={newTitle.trim() === ''} className="rounded-full border border-teal-400/70 px-4 py-1.5 text-sm text-teal-200 outline-none hover:bg-slate-900 focus-visible:ring-2 focus-visible:ring-teal-400 disabled:opacity-50">
                Add
              </button>
              <button type="button" onClick={() => { setAdding(false); setAddError('') }} className="rounded-full border border-slate-700 px-4 py-1.5 text-sm outline-none hover:bg-slate-900 focus-visible:ring-2 focus-visible:ring-teal-400">
                Cancel
              </button>
              {addError && <p role="alert" className="w-full text-sm text-red-300">{addError}</p>}
            </form>
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="rounded-full border border-slate-700 px-4 py-1.5 text-sm outline-none hover:bg-slate-900 focus-visible:ring-2 focus-visible:ring-teal-400">
              + New song
            </button>
          )}
        </div>
      )}
      </div>

      {unknownSong && (
        <p role="alert" className="mt-4 rounded-lg bg-slate-900 p-3 text-sm text-slate-300">
          That song is not in this church.
        </p>
      )}
      {songId === '' && (
        <Empty>
          Choose a song, or play one on the Practice page.{' '}
          <Link to="/practice" className="underline underline-offset-2">
            Go to Practice
          </Link>
        </Empty>
      )}
      {songId !== '' && loaded?.id !== songId && <p className="mt-6 text-sm text-slate-400">Loading…</p>}
      {loaded?.id === songId && loaded.error !== '' && <Empty>Could not load the chart ({loaded.error}).</Empty>}
      {loaded?.id === songId && loaded.error === '' && text === null && !editing && (
        <Empty>
          No chart for this song yet.
          {mayEdit && (
            <>
              {' '}
              <button type="button" onClick={() => setEditing(true)} className="underline underline-offset-2">
                Create one
              </button>
            </>
          )}
        </Empty>
      )}

      {editing && loaded?.id === songId && (
        <ChartEditor key={songId} initial={text ?? TEMPLATE} syncing={songId === now.songId} onSave={save} onCancel={() => setEditing(false)} />
      )}

      {chart && !editing && (
        <div className="mt-3">
          <ChartPages
            key={songId}
            chart={chart}
            songId={songId}
            title={library?.find((s) => s.id === songId)?.title ?? ''}
            fallbackKey={songMusic?.key}
            bpm={songMusic?.bpm}
            active={active}
            onJump={syncing ? jump : undefined}
            hasCues={hasCues}
            follow={follow}
            onFollow={setFollow}
            playing={playing}
            actions={
              mayEdit && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="rounded-full border border-slate-700 px-3 py-1.5 text-sm outline-none hover:bg-slate-900 focus-visible:ring-2 focus-visible:ring-teal-400"
                >
                  Edit
                </button>
              )
            }
          />
        </div>
      )}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="mt-6 rounded-2xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">{children}</p>
}
