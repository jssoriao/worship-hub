import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
export interface NewSong {
  title: string
  artist: string
  key: string
}
/**
 * A song that is not in the church's list yet, in one row under the song search. "Add to service" (Enter) keeps
 * just its name in the service; "Add to song list" also adds it to the church's list, chart only. Either adds a
 * line to the draft; Save makes it real. The page closes the row on Esc.
 */
export function NewSongForm({ onAdd }: { onAdd: (song: NewSong, listed: boolean) => void }) {
  const [song, setSong] = useState<NewSong>({ title: '', artist: '', key: '' })
  const ready = song.title.trim() !== ''
  const add = (e: FormEvent | React.MouseEvent, listed: boolean) => {
    e.preventDefault()
    if (ready) onAdd({ title: song.title.trim(), artist: song.artist.trim(), key: song.key.trim() }, listed)
  }
  return (
    <Card className="p-2">
      <form onSubmit={(e) => add(e, false)} className="grid gap-2 sm:grid-cols-[2fr_1fr_5rem_auto_auto]">
        <Label className="sr-only" htmlFor="ns-title">
          Song title
        </Label>
        <Input id="ns-title" required autoFocus maxLength={120} placeholder="Title" className="h-8" value={song.title} onChange={(e) => setSong({ ...song, title: e.target.value })} />
        <Label className="sr-only" htmlFor="ns-artist">
          Artist (optional)
        </Label>
        <Input id="ns-artist" maxLength={120} placeholder="Artist (optional)" className="h-8" value={song.artist} onChange={(e) => setSong({ ...song, artist: e.target.value })} />
        <Label className="sr-only" htmlFor="ns-key">
          Key (optional)
        </Label>
        <Input id="ns-key" maxLength={12} placeholder="Key" className="h-8" value={song.key} onChange={(e) => setSong({ ...song, key: e.target.value })} />
        <Button type="submit" size="sm" disabled={!ready} title="Keeps only its name in this service; you can still attach links">
          Add to service
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={!ready} title="Also adds it to the church's song list (chart only, no stems)" onClick={(e) => add(e, true)}>
          Add to song list
        </Button>
      </form>
    </Card>
  )
}
