import { ArchiveIcon, ArchiveRestoreIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Alert } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { PageHeader } from '../components/PageHeader'
import { useChurch } from '../lib/church-context'
import { archiveSong, listSongsAdmin, restoreSong, type AdminSong } from '../lib/songs-admin-api'

const PARTS = [
  ['stems', 'Stems'],
  ['analysis', 'Analysis'],
  ['chart', 'Chart'],
] as const

/** What a song has, as three small marks: filled when it is there. */
function Has({ song }: { song: AdminSong }) {
  return (
    <ul aria-label="What this song has" className="flex flex-wrap gap-1.5">
      {PARTS.map(([key, label]) => (
        <li key={key}>
          <Badge variant={song.has[key] ? 'secondary' : 'outline'} className={song.has[key] ? '' : 'text-muted-foreground'}>
            {label}
            <span className="sr-only">{song.has[key] ? ': yes' : ': no'}</span>
          </Badge>
        </li>
      ))}
    </ul>
  )
}

/**
 * Admins and owners: every song of the church and what it has, and Archive / Restore. The app never
 * deletes a song (regenerating its AI data costs credits): archiving hides it for everyone and keeps its files.
 */
export default function SongsAdminPage() {
  const church = useChurch()
  const [songs, setSongs] = useState<AdminSong[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState<AdminSong | null>(null)

  const load = useCallback(
    () =>
      listSongsAdmin().then(
        (list) => {
          setSongs(list)
          setError('')
        },
        (e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the songs.'),
      ),
    [],
  )
  useEffect(() => {
    // a promise, so state is only set after the answer arrives
    void load()
  }, [load, church.id])

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
      setAsking(null)
    }
  }

  const active = songs?.filter((s) => !s.archivedAt) ?? []
  const archived = songs?.filter((s) => s.archivedAt) ?? []

  return (
    <div className="mx-auto max-w-4xl px-4 pt-3 pb-24 md:px-6">
      <PageHeader title="Songs" />

      {error && (
        <Alert variant="destructive" className="mt-4">
          {error}
        </Alert>
      )}
      {!songs && !error && (
        <p role="status" className="mt-6 text-sm text-muted-foreground">
          Loading…
        </p>
      )}

      {songs && (
        <>
          <Card className="mt-5 gap-0 py-0">
            {active.length === 0 ? (
              <p className="px-3 py-4 text-sm text-muted-foreground">No songs yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {active.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{s.title}</p>
                      {s.artist && <p className="truncate text-xs text-muted-foreground">{s.artist}</p>}
                    </div>
                    <Has song={s} />
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => setAsking(s)}>
                      <ArchiveIcon aria-hidden="true" />
                      Archive
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {archived.length > 0 && (
            <section aria-label="Archived songs" className="mt-8">
              <h2 className="px-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Archived ({archived.length})</h2>
              <Card className="mt-2 gap-0 py-0">
                <ul className="divide-y divide-border">
                  {archived.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-muted-foreground">{s.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {new Date(s.archivedAt!).toLocaleDateString()}
                          {s.archivedBy && ` · ${s.archivedBy}`}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => restoreSong(s.id))}>
                        <ArchiveRestoreIcon aria-hidden="true" />
                        Restore
                      </Button>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          )}
        </>
      )}

      <Dialog open={asking !== null} onOpenChange={(o) => !o && !busy && setAsking(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Archive “{asking?.title}”?</DialogTitle>
            <DialogDescription>It disappears for everyone. Nothing is deleted, and you can restore it here.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setAsking(null)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => asking && void run(() => archiveSong(asking.id))} autoFocus>
              {busy ? 'Archiving…' : 'Archive'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
