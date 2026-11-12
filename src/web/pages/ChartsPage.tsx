import { PlusIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Link, useSearchParams } from 'react-router'
import ChartEditor, { TEMPLATE } from '../components/ChartEditor'
import ChartPages from '../components/ChartPages'
import { SongPicker } from '../components/SongPicker'
import { PageHeader } from '../components/PageHeader'
import { resolveSongParam, songForAddress, songFromAddress } from '../lib/address'
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
  const picked = songFromAddress(params.get('song'))
  const setPicked = (id: string) => setParams(id ? { song: songForAddress(id) } : {}, { replace: true })
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [follow, setFollow] = useState(true)
  const [editing, setEditing] = useState(false)
  // editing and adding songs follow the person's permissions in this church
  const church = useChurch()
  const mayEdit = church.can({ content: ['edit'] })
  const mayAdd = church.can({ song: ['create'] })
  const [position, setPosition] = useState(-1)

  useEffect(() => {
    fetchLibrary(church.id)
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
    fetchSongMusic(songId)
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
    <div className={`mx-auto px-4 pt-3 md:px-6 ${editing ? 'max-w-5xl pb-24' : 'max-w-6xl pb-2'}`}>
      <PageHeader
        title="Charts"
        actions={
          <>
            <SongPicker songs={library ?? []} value={songId} onPick={pick} loading={library === null} className="w-full sm:w-80" />
            {mayAdd && !adding && (
              <Button variant="outline" onClick={() => setAdding(true)}>
                <PlusIcon aria-hidden="true" />
                New song
              </Button>
            )}
          </>
        }
      />
      {mayAdd && adding && (
        <form onSubmit={(e) => void addSong(e)} className="mt-3 flex flex-wrap items-center gap-2">
          <Label className="sr-only" htmlFor="new-song">
            Song title
          </Label>
          <Input id="new-song" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Song title" maxLength={120} autoFocus className="w-auto flex-1" />
          <Button type="submit" disabled={newTitle.trim() === ''}>
            Add
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setAdding(false)
              setAddError('')
            }}
          >
            Cancel
          </Button>
          {addError && (
            <p role="alert" className="w-full text-sm text-red-300">
              {addError}
            </p>
          )}
        </form>
      )}

      {unknownSong && (
        <Alert className="mt-4">That song is not in this church.</Alert>
      )}
      {songId === '' && (
        <Empty>
          Choose a song, or play one on the Practice page.{' '}
          <Link to="/practice" className="underline underline-offset-2">
            Go to Practice
          </Link>
        </Empty>
      )}
      {songId !== '' && loaded?.id !== songId && <p className="mt-6 text-sm text-muted-foreground">Loading…</p>}
      {loaded?.id === songId && loaded.error !== '' && <Empty>Could not load the chart ({loaded.error}).</Empty>}
      {loaded?.id === songId && loaded.error === '' && text === null && !editing && (
        <Empty>
          No chart for this song yet.
          {mayEdit && (
            <>
              {' '}
              <Button variant="link" className="h-auto p-0 text-highlight" onClick={() => setEditing(true)}>
                Create one
              </Button>
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
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )
            }
          />
        </div>
      )}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="mt-6 rounded-2xl border border-dashed border-input p-6 text-center text-sm text-muted-foreground">{children}</p>
}
