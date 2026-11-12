import { ArrowRightIcon, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageHeader } from '../components/PageHeader'
import { authClient } from '../lib/auth-client'
import { useChurch } from '../lib/church-context'
import { practiceLink, useNowPlaying } from '../lib/now-playing-context'
import { PAGES } from '../lib/pages'

const ABOUT: Record<string, string> = {
  '/practice': "Play a song's stems together. Mute, solo and balance each part.",
  '/charts': 'Chord and lyric charts that follow the music as it plays.',
  '/arrange': 'Your own order of the sections, with parts muted where you want.',
  '/members': 'Add people, give them roles, remove them.',
}

/** A way into a page: what it is on the left, its icon in the brand gradient on the right. */
function Shortcut({ to, title, icon: Icon, children }: { to: string; title: string; icon: LucideIcon; children: string }) {
  return (
    <Link to={to} className="group rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="h-full flex-row items-start gap-4 p-4 transition-colors group-hover:border-white/20">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</p>
          <p className="mt-1 text-sm text-secondary-foreground">{children}</p>
        </div>
        <span aria-hidden="true" className="bg-brand-gradient flex size-10 shrink-0 items-center justify-center rounded-xl text-primary-foreground shadow-[0_6px_18px_-6px_var(--brand)]">
          <Icon className="size-5" />
        </span>
      </Card>
    </Link>
  )
}

/** Ways into the rest of the app, and the song that is playing. */
export default function HomePage() {
  const now = useNowPlaying()
  const church = useChurch()
  const { data: session } = authClient.useSession()
  const practice = practiceLink(now, church.id)
  const first = (session?.user.name ?? '').trim().split(/\s+/)[0]
  const mayManage = church.can({ member: ['create'] })
  return (
    <div className="mx-auto max-w-6xl px-4 pt-3 pb-24 md:px-6">
      <PageHeader title="Home" />
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="justify-between gap-4 p-6 lg:col-span-2">
          <div>
            <p className="text-sm text-muted-foreground">Welcome back,</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight">{first || 'friend'}</p>
            <p className="mt-2 max-w-md text-sm text-secondary-foreground">Your team's songs, charts and arrangements for {church.name || 'your church'}, in one place.</p>
          </div>
          <Link to={practice} className={`${buttonVariants()} w-fit`}>
            Start practising
            <ArrowRightIcon aria-hidden="true" />
          </Link>
        </Card>
        <Card className="justify-center gap-2 p-6">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Playing now</p>
          {now.title ? (
            <Link to={practice} className="flex min-w-0 items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {now.playing && <span aria-hidden="true" className="size-2.5 shrink-0 animate-pulse rounded-full bg-highlight" />}
              <span className="truncate text-lg font-medium">{now.title}</span>
            </Link>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing yet. Open a song in Practice.</p>
          )}
        </Card>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PAGES.filter((p) => p.to !== '/' && (!p.admin || mayManage)).map((p) => (
          <Shortcut key={p.to} to={p.to === '/practice' ? practice : p.to} title={p.label} icon={p.icon}>
            {ABOUT[p.to] ?? ''}
          </Shortcut>
        ))}
      </div>
    </div>
  )
}
