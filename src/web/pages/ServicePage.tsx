import { useEffect, useRef, useState } from 'react'
import { Link, useBlocker, useNavigate, useParams, useSearchParams } from 'react-router'
import { ArrowDownIcon, ArrowLeftIcon, ArrowUpIcon, AudioLinesIcon, ChevronDownIcon, CopyIcon, ExternalLinkIcon, LinkIcon, PencilIcon, PlayIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PageHeader } from '../components/PageHeader'
import { SongPicker } from '../components/SongPicker'
import { UnsavedDialog } from '../components/player/EditControls'
import { MiniPlayer } from '../components/services/MiniPlayer'
import { NewSongForm, type NewSong } from '../components/services/NewSongForm'
import { ServiceDialog } from '../components/services/ServiceDialog'
import { SongChart } from '../components/services/SongChart'
import { practicePath } from '../lib/address'
import { useChurch } from '../lib/church-context'
import { mediaOf } from '../lib/media'
import { useNowPlaying } from '../lib/now-playing-context'
import { formatDate, formatTime, isHttps, linkText, move, serviceName } from '../lib/services'
import { cloneService, deleteService, getService, saveItems, updateService, type ItemDraft, type ServiceFull, type ServiceItem } from '../lib/services-api'
import { fetchLibrary, type LibrarySong } from '../lib/sources'
import NotFoundPage from './NotFoundPage'
/** One line of the setlist while it is being edited. `uid` is only for React; `newSong` is made on save. */
interface Line {
  uid: string
  id?: string
  kind: ServiceItem['kind']
  songId: string | null
  newSong?: { title: string; artist: string; key: string }
  title: string
  /** the day's key; empty = the song's own */
  key: string
  songKey: string | null
  /** its song is archived: only the name, key and links are shown */
  archived: boolean
  notes: string
  links: { url: string; label: string }[]
}
type Tab = 'order' | 'songs'
const uid = () => crypto.randomUUID()
const lineOf = (item: ServiceItem): Line => ({ uid: uid(), id: item.id, kind: item.kind, songId: item.songId, title: item.title, key: item.key ?? '', songKey: item.songKey, archived: item.archived, notes: item.notes ?? '', links: item.links })
/** What changes when saved, as text: two drafts are the same when this is. */
const snapshot = (lines: Line[]) => JSON.stringify(lines.map(({ uid: _u, ...rest }) => rest))
const draftOf = (line: Line): ItemDraft => ({
  id: line.id,
  kind: line.kind,
  ...(line.newSong ? { newSong: { title: line.newSong.title, artist: line.newSong.artist || null, key: line.newSong.key || null } } : line.songId ? { songId: line.songId } : { title: line.title }),
  key: line.key.trim() || null,
  notes: line.notes.trim() || null,
  links: line.links,
})
const keyOf = (line: Line) => line.key || line.songKey
const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.')
const iconButton = 'size-7'
/** Delete with a second click to confirm. */
function DeleteButton({ onDelete }: { onDelete: () => Promise<void> }) {
  const [sure, setSure] = useState(false)
  const [busy, setBusy] = useState(false)
  return sure ? (
    <span className="inline-flex gap-1">
      <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => (setBusy(true), onDelete().catch(() => setBusy(false)))}>
        Delete service
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setSure(false)}>
        Keep
      </Button>
    </span>
  ) : (
    <Button type="button" size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setSure(true)}>
      <Trash2Icon /> Delete
    </Button>
  )
}
/** Everyone reads a service; editors, admins and owners also change its details and setlist. */
export default function ServicePage() {
  const { serviceId = '' } = useParams()
  const church = useChurch()
  const navigate = useNavigate()
  const now = useNowPlaying()
  const canPlan = church.can({ service: ['plan'] })
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'songs' ? 'songs' : 'order'
  const [service, setService] = useState<ServiceFull | null>(null)
  const [missing, setMissing] = useState(false)
  const [lines, setLines] = useState<Line[]>([])
  // what the server has (as a snapshot), and the latest lines, which the saving loop reads
  const [saved, setSaved] = useState('[]')
  const savedRef = useRef('[]')
  const linesRef = useRef<Line[]>([])
  const savedLines = useRef<Line[]>([])
  const saving = useRef(false)
  const again = useRef(false)
  const [busy, setBusy] = useState(false)
  const [songs, setSongs] = useState<LibrarySong[] | null>(null)
  const [selected, setSelected] = useState('')
  // the selected song's media list is folded away (its chart stays)
  const [folded, setFolded] = useState(false)
  const [video, setVideo] = useState<{ id: string; title: string } | null>(null)
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState<'edit' | 'clone' | null>(null)
  const [adding, setAdding] = useState(false)
  const accept = (s: ServiceFull) => {
    const l = s.items.map(lineOf)
    setService(s)
    setLines(l)
    linesRef.current = l
    savedLines.current = l
    savedRef.current = snapshot(l)
    setSaved(savedRef.current)
  }
  useEffect(() => {
    let live = true
    getService(serviceId).then(
      ({ service: s }) => live && accept(s),
      (e: unknown) => {
        if (!live) return
        if (e instanceof Error && 'status' in e && e.status === 404) setMissing(true)
        else setError(message(e))
      },
    )
    return () => {
      live = false
    }
  }, [serviceId, church.id])
  useEffect(() => {
    let live = true
    if (canPlan) fetchLibrary(church.id).then((l) => live && setSongs(l), () => live && setSongs([]))
    return () => {
      live = false
    }
  }, [canPlan, church.id])
  const dirty = snapshot(lines) !== saved
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  /** Typing in a field: the draft changes. */
  const type = (i: number, patch: Partial<Line>) => {
    const next = linesRef.current.map((l, j) => (j === i ? { ...l, ...patch } : l))
    linesRef.current = next
    setLines(next)
  }
  /** A change to the setlist (move, remove, a link): shown now, kept as a draft until Save. */
  const update = (change: (ls: Line[]) => Line[]) => {
    const next = change(linesRef.current)
    linesRef.current = next
    setLines(next)
  }
  /** Throws the draft away: back to what the server has. */
  const discard = () => {
    linesRef.current = savedLines.current
    setLines(savedLines.current)
    setError('')
  }
  /**
   * Saves the draft: sends the lines to the server, one request at a time. Changes made while one is on
   * its way go in the next request. What the server made (ids, songs added to the list) is copied back
   * into the lines. A failure keeps the draft on screen and shows the message; Save tries again.
   */
  const flush = async () => {
    if (saving.current) {
      again.current = true
      return
    }
    if (!service) return
    saving.current = true
    setBusy(true)
    try {
      do {
        again.current = false
        const sent = linesRef.current
        if (snapshot(sent) === savedRef.current) continue
        setError('')
        const { service: next } = await saveItems(service.id, sent.map(draftOf))
        const made = new Map(sent.map((l, i) => [l.uid, next.items[i]]))
        const merge = (l: Line): Line => {
          const m = made.get(l.uid)
          if (!m) return l
          return { ...l, id: m.id, songId: m.songId, songKey: m.songKey, title: m.songId ? m.title : l.title, newSong: m.songId ? undefined : l.newSong }
        }
        linesRef.current = linesRef.current.map(merge)
        setLines(linesRef.current)
        savedLines.current = sent.map(merge)
        savedRef.current = snapshot(savedLines.current)
        setSaved(savedRef.current)
        if (sent.some((l) => l.newSong)) fetchLibrary(church.id).then(setSongs, () => {})
      } while (again.current)
    } catch (e) {
      setError(message(e))
    } finally {
      saving.current = false
      setBusy(false)
    }
  }
  // leaving for another page with changes that are not saved asks first (the tabs of this page are not leaving)
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname)
  // Esc closes the New song row when it is open; otherwise it throws the unsaved changes away. Something else
  // on screen using Esc (a dialog, an open song list) comes first.
  useEffect(() => {
    if (!dirty && !adding) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[role=dialog],[role=listbox]')) return
      if (adding) setAdding(false)
      else discard()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  // Ctrl or Cmd + S saves
  useEffect(() => {
    if (!dirty) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void flush()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  if (missing) return <NotFoundPage />
  if (!service) {
    return (
      <div className="mx-auto max-w-6xl px-4 pt-3 pb-24 md:px-6">
        <PageHeader title="Service" />
        {error ? (
          <Alert variant="destructive" className="mt-3">
            {error}
          </Alert>
        ) : (
          <p role="status" className="mt-4 text-sm text-muted-foreground">
            Loading…
          </p>
        )}
      </div>
    )
  }
  const addSong = (id: string) => {
    const song = songs?.find((s) => s.id === id)
    if (!song) return
    update((ls) => [...ls, { uid: uid(), kind: 'song', songId: song.id, title: song.title, key: '', songKey: song.key ?? null, archived: false, notes: '', links: [] }])
  }
  /** A song from the New song panel. `listed`: also add it to the church's list when saved; otherwise it is only a name in this service. */
  const addNew = (song: NewSong, listed: boolean) => {
    update((ls) => [
      ...ls,
      listed
        ? { uid: uid(), kind: 'song', songId: null, newSong: song, title: song.title, key: '', songKey: song.key || null, archived: false, notes: '', links: [] }
        : { uid: uid(), kind: 'song', songId: null, title: song.title, key: song.key, songKey: null, archived: false, notes: '', links: [] },
    ])
    setAdding(false)
  }
  /** a field of a line: typing changes the draft; Enter leaves the field */
  const field = { onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && e.currentTarget.blur() }
  const play = (id: string, title: string) => {
    // one sound at a time: Practice stops while a video plays
    now.getTransport()?.pause()
    setVideo({ id, title })
  }
  const songLines = lines.filter((l) => l.kind === 'song')
  const current = songLines.find((l) => l.uid === selected) ?? songLines[0]
  const when = `${formatDate(service.date)}${service.time ? ` · ${formatTime(service.time)}` : ''}`
  const tabButton = (value: Tab, label: string, count: number) => (
    <button
      key={value}
      type="button"
      role="tab"
      aria-selected={tab === value}
      onClick={() => setParams(value === 'order' ? {} : { tab: value }, { replace: true })}
      className={`-mb-px border-b-2 px-3 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${tab === value ? 'border-highlight text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
    >
      {label} <span className="text-xs opacity-70">{count}</span>
    </button>
  )
  return (
    <div className="mx-auto max-w-6xl px-4 pt-3 pb-24 md:px-6">
      <PageHeader
        title={serviceName(service)}
        description={
          <>
            {when}
            {service.notes && <span className="block whitespace-pre-wrap">{service.notes}</span>}
          </>
        }
        actions={
          <>
            <Link to="/services" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeftIcon aria-hidden="true" className="size-4" /> All services
            </Link>
            {canPlan && (
              <div className="ml-auto flex gap-1">
                <Button type="button" variant="outline" size="sm" disabled={dirty || busy} title={dirty || busy ? 'Save your changes first' : undefined} onClick={() => setDialog('clone')}>
                  <CopyIcon /> Clone
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setDialog('edit')}>
                  <PencilIcon /> Edit
                </Button>
              </div>
            )}
          </>
        }
      />
      {error && (
        <Alert variant="destructive" className="mt-3">
          {error}
        </Alert>
      )}
      <div className="mt-3 flex items-center border-b border-border">
        <div role="tablist" className="flex">
          {tabButton('order', 'Order', lines.length)}
          {tabButton('songs', 'Songs', songLines.length)}
        </div>
        {canPlan && dirty && (
          <div className="ml-auto flex gap-1 pb-1">
            <Button type="button" variant="ghost" size="xs" disabled={busy} title="Throw away the changes (Esc)" onClick={discard}>
              Discard
            </Button>
            <Button type="button" size="xs" disabled={busy} title="Save the changes (Ctrl+S)" onClick={() => void flush()}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        )}
      </div>
      {lines.length === 0 && <p className="mt-3 text-sm text-muted-foreground">{canPlan ? 'No songs yet. Add the first one below.' : 'No songs yet.'}</p>}
      {tab === 'order' && lines.length > 0 && (
        <Card className="mt-3 gap-0 overflow-hidden py-0">
          <ol className="divide-y divide-border">
            {lines.map((line, i) => (
              <li key={line.uid} className={`flex items-center gap-2 px-3 py-1.5 text-sm ${line.kind === 'header' ? 'bg-muted/40' : ''}`}>
                <span className="w-5 shrink-0 text-xs text-muted-foreground tabular-nums">{line.kind === 'header' ? '' : lines.slice(0, i + 1).filter((l) => l.kind !== 'header').length}</span>
                <span className={`min-w-0 flex-1 truncate ${line.kind === 'header' ? 'text-xs font-semibold tracking-wide text-muted-foreground uppercase' : 'font-medium'}`}>
                  {line.title}
                  {line.newSong && <span className="ml-2 text-xs font-normal text-muted-foreground">New song</span>}
                </span>
                {canPlan ? (
                  <>
                    {line.kind !== 'header' && (
                      <>
                    <Input aria-label={`Key of ${line.title}`} maxLength={12} placeholder={line.songKey ?? 'Key'} className="h-7 w-16 text-center" value={line.key} onChange={(e) => type(i, { key: e.target.value })} {...field} />
                    <Input aria-label={`Notes for ${line.title}`} maxLength={1000} placeholder="Notes" className="h-7 w-64" value={line.notes} onChange={(e) => type(i, { notes: e.target.value })} {...field} />
                      </>
                    )}
                    <div className="flex shrink-0">
                      <Button type="button" variant="ghost" size="icon-sm" className={iconButton} aria-label={`Move ${line.title} up`} disabled={i === 0} onClick={() => update((ls) => move(ls, i, -1))}>
                        <ArrowUpIcon />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-sm" className={iconButton} aria-label={`Move ${line.title} down`} disabled={i === lines.length - 1} onClick={() => update((ls) => move(ls, i, 1))}>
                        <ArrowDownIcon />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-sm" className={iconButton} aria-label={`Remove ${line.title}`} onClick={() => update((ls) => ls.filter((_, j) => j !== i))}>
                        <Trash2Icon />
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    {line.notes && <span className="max-w-64 truncate text-xs text-muted-foreground">{line.notes}</span>}
                    {line.kind === 'item' && line.links.length > 0 && <LinkIcon aria-label="Has links" className="size-3 shrink-0 text-muted-foreground" />}
                    {keyOf(line) && <span className="shrink-0 rounded-full border border-input px-2 py-0.5 text-xs">{keyOf(line)}</span>}
                  </>
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}
      {tab === 'songs' && !current && lines.length > 0 && <p className="mt-3 text-sm text-muted-foreground">No songs in this service.</p>}
      {tab === 'songs' && current && (
        <div className="mt-3 grid items-start gap-3 md:grid-cols-[19rem_1fr]">
          <ul className="grid min-w-0 grid-cols-1 gap-1.5">
            {songLines.map((line) => {
              const chosen = line.uid === current.uid
              const open = chosen && !folded
              return (
                <li key={line.uid}>
                  <Card className="gap-0 overflow-hidden py-0">
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => {
                        // the shown song folds and unfolds; another song is shown, unfolded
                        if (chosen) setFolded((f) => !f)
                        else {
                          setSelected(line.uid)
                          setFolded(false)
                        }
                      }}
                      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring ${chosen ? 'bg-accent/50' : 'hover:bg-accent/30'}`}
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">{line.title}</span>
                      {keyOf(line) && <span className="shrink-0 rounded-full border border-input px-2 py-0.5 text-xs">{keyOf(line)}</span>}
                      <ChevronDownIcon aria-hidden="true" className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
                    </button>
                    {open && (
                      <ul className="grid grid-cols-1 gap-1 border-t border-border p-1.5">
                        {line.songId && !line.archived && (
                          <li>
                            <Link to={practicePath(line.songId)} className="flex items-center gap-2 rounded-md p-1 text-sm hover:bg-accent/40">
                              <span className="grid h-8 w-14 shrink-0 place-items-center rounded bg-muted text-muted-foreground">
                                <AudioLinesIcon className="size-4" />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block text-xs text-muted-foreground">Stems</span>
                                <span className="block truncate">Practice</span>
                              </span>
                            </Link>
                          </li>
                        )}
                        {line.links.map((l, k) => {
                          const media = mediaOf(l.url)
                          const name = linkText(l)
                          const thumb = (
                            <span className="relative grid h-8 w-14 shrink-0 place-items-center overflow-hidden rounded bg-muted text-muted-foreground">
                              {media.kind === 'youtube' ? (
                                <>
                                  <img src={media.thumbnail} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
                                  <PlayIcon className="relative size-4 fill-white text-white drop-shadow" />
                                </>
                              ) : (
                                <LinkIcon className="size-4" />
                              )}
                            </span>
                          )
                          const label = (
                            <span className="min-w-0 flex-1 text-left">
                              <span className="block text-xs text-muted-foreground">{media.kind === 'youtube' ? 'YouTube' : new URL(l.url).hostname.replace(/^www\./, '')}</span>
                              <span className="block truncate text-sm">{name}</span>
                            </span>
                          )
                          return (
                            <li key={`${l.url}-${k}`} className="flex items-center gap-1 rounded-md hover:bg-accent/40">
                              {media.kind === 'youtube' ? (
                                <button type="button" onClick={() => play(media.id, `${line.title} · ${name}`)} className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                  {thumb}
                                  {label}
                                </button>
                              ) : (
                                <a href={l.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                  {thumb}
                                  {label}
                                  <ExternalLinkIcon aria-hidden="true" className="mr-1 size-3 shrink-0 text-muted-foreground" />
                                </a>
                              )}
                              {media.kind === 'youtube' && (
                                <a href={l.url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${name} on YouTube`} className="grid size-6 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-foreground">
                                  <ExternalLinkIcon className="size-3" />
                                </a>
                              )}
                              {canPlan && (
                                <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove link ${name}`} onClick={() => update((ls) => ls.map((l) => (l.uid === line.uid ? { ...l, links: l.links.filter((_, j) => j !== k) } : l)))}>
                                  <XIcon />
                                </Button>
                              )}
                            </li>
                          )
                        })}
                        {!line.songId && line.links.length === 0 && !canPlan && <li className="p-1 text-xs text-muted-foreground">Nothing attached.</li>}
                        {canPlan && (
                          <li className="p-1">
                            <AddLink key={line.uid} onAdd={(l) => update((ls) => ls.map((x) => (x.uid === line.uid ? { ...x, links: [...x.links, l] } : x)))} disabled={line.links.length >= 10} />
                          </li>
                        )}
                      </ul>
                    )}
                  </Card>
                </li>
              )
            })}
          </ul>
          <div className="min-w-0">
            <SongChart key={current.uid} songId={current.archived ? null : current.songId} archived={current.archived} title={current.title} songKey={current.songKey} serviceKey={current.key.trim() || null} />
          </div>
        </div>
      )}
      {canPlan && tab === 'order' && (
        <div className="mt-2 grid gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <SongPicker songs={songs ?? []} value="" loading={songs === null} onPick={addSong} className="min-w-0 flex-1 basis-60" />
            <Button type="button" variant="outline" size="sm" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
              <PlusIcon /> New song
            </Button>
          </div>
          {adding && <NewSongForm onAdd={addNew} />}
        </div>
      )}
      <UnsavedDialog
        open={blocker.state === 'blocked'}
        saving={busy}
        error={error}
        onSave={() => void flush().then(() => savedRef.current === snapshot(linesRef.current) && blocker.proceed?.())}
        onDiscard={() => {
          discard()
          blocker.proceed?.()
        }}
        onCancel={() => blocker.reset?.()}
      />
      {dialog === 'edit' && (
        <ServiceDialog
          open
          heading="Edit service"
          action="Save"
          initial={{ date: service.date, time: service.time ?? '', title: service.title ?? '', notes: service.notes ?? '' }}
          onClose={() => setDialog(null)}
          extra={
            <DeleteButton
              onDelete={async () => {
                await deleteService(service.id)
                navigate('/services')
              }}
            />
          }
          onSubmit={async (f) => {
            const { service: next } = await updateService(service.id, { date: f.date, time: f.time || null, title: f.title.trim() || null, notes: f.notes.trim() || null })
            // the setlist being edited stays as it is; only the details change
            setService({ ...service, date: next.date, time: next.time, title: next.title, notes: next.notes })
            setDialog(null)
          }}
        />
      )}
      {dialog === 'clone' && (
        <ServiceDialog
          open
          datesOnly
          heading="Clone service"
          action="Clone"
          initial={{ date: '', time: service.time ?? '', title: '', notes: '' }}
          onClose={() => setDialog(null)}
          onSubmit={async (f) => {
            const { service: copy } = await cloneService(service.id, { date: f.date, time: f.time || null })
            navigate(`/services/${copy.id}`)
          }}
        />
      )}
      <MiniPlayer video={video} onClose={() => setVideo(null)} />
    </div>
  )
}
/** A web address and an optional name, added to a song. Only https is taken. */
function AddLink({ onAdd, disabled }: { onAdd: (link: { url: string; label: string }) => void; disabled: boolean }) {
  const [url, setUrl] = useState('')
  const [label, setLabel] = useState('')
  const [problem, setProblem] = useState('')
  const submit = (e: { preventDefault: () => void; stopPropagation: () => void }) => {
    e.preventDefault()
    e.stopPropagation()
    if (!isHttps(url)) return setProblem('Links must start with https://')
    onAdd({ url: url.trim(), label: label.trim() })
    setUrl('')
    setLabel('')
    setProblem('')
  }
  return (
    <div>
      <div
        className="grid grid-cols-[1fr_auto] gap-1.5"
        role="group"
        aria-label="Add a link"
        // leaving the row with an address typed adds it, so a link is not lost by going straight to Save
        onBlur={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null) || !url.trim()) return
          if (isHttps(url)) submit(e)
          else setProblem('Links must start with https://')
        }}
      >
        <Input type="url" inputMode="url" aria-label="Link address" placeholder="Add a link: https://…" maxLength={500} className="col-span-2 h-7 text-xs" value={url} disabled={disabled} aria-invalid={problem ? true : undefined} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit(e)} />
        {url.trim() && (
          <>
            <Input aria-label="Link name (optional)" placeholder="Link name (optional)" maxLength={100} className="h-7 text-xs" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit(e)} />
            <Button type="button" variant="outline" size="xs" onClick={submit}>
              Add
            </Button>
          </>
        )}
      </div>
      {problem && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {problem}
        </p>
      )}
    </div>
  )
}
