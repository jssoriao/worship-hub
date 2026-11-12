import { Link } from 'react-router'
import { useChurch } from '../lib/church-context'
import { practiceLink, useNowPlaying } from '../lib/now-playing-context'

function Card({ to, title, children }: { to: string; title: string; children: string }) {
  return (
    <Link
      to={to}
      className="block rounded-2xl border border-border bg-card p-4 outline-none transition-colors hover:border-input hover:bg-card/70 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{children}</p>
    </Link>
  )
}

/** Nothing lives here yet beyond ways into the rest of the app. */
export default function HomePage() {
  const now = useNowPlaying()
  const { playing, title } = now
  const church = useChurch()
  const practice = practiceLink(now, church.id)
  return (
    <div className="mx-auto max-w-3xl px-3 pb-24 pt-8">
      <h1 className="text-2xl font-semibold tracking-tight">Welcome</h1>
      <p className="mt-2 text-muted-foreground">Your team's songs, charts and schedule will come together here.</p>

      {playing && (
        <Link
          to={practice}
          className="mt-6 flex items-center gap-3 rounded-2xl border border-teal-900 bg-teal-950/40 p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-teal-400" />
          <span className="min-w-0">
            <span className="block text-xs uppercase tracking-wide text-highlight">Playing now</span>
            <span className="block truncate font-medium">{title || 'Practice'}</span>
          </span>
        </Link>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Card to={practice} title="Practice">
          Play a song's stems together. Mute, solo and balance each part.
        </Card>
        <Card to="/charts" title="Charts">
          Chord and lyric charts for each song. Coming soon.
        </Card>
      </div>
    </div>
  )
}
