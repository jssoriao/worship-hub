import { Link, NavLink } from 'react-router'
import { useChurch } from '../lib/church-context'
import { practiceLink, useNowPlaying } from '../lib/now-playing-context'
import { AccountMenu } from './AccountMenu'
import { NativeSelect } from '@/components/ui/native-select'

/** The pages of the app, in the order they appear in the bar. `admin` pages show only to people who may manage members. */
const PAGES = [
  { to: '/', label: 'Home', end: true, admin: false },
  { to: '/practice', label: 'Practice', end: false, admin: false },
  { to: '/charts', label: 'Charts', end: false, admin: false },
  { to: '/arrange', label: 'Arrange', end: false, admin: false },
  { to: '/members', label: 'Members', end: false, admin: true },
] as const

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `relative inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
    isActive ? 'bg-accent text-white' : 'text-muted-foreground hover:bg-card hover:text-foreground'
  }`

/**
 * The top bar, as in most dashboards: the app and the church you are working in on the left, the
 * pages next to them, and the person's account menu on the right. On a narrow screen the pages
 * drop to a second row.
 */
export function NavBar() {
  const now = useNowPlaying()
  const { playing, title } = now
  const church = useChurch()
  // back to Practice with the song that is open there (no song in the address means none)
  const practice = practiceLink(now, church.id)
  const mayManage = church.can({ member: ['create'] })
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
        <Link
          to="/"
          className="rounded-md text-sm font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Worship Hub
        </Link>
        {church.name && (
          <>
            <span aria-hidden="true" className="text-slate-700">
              /
            </span>
            {church.churches.length > 1 ? (
              <>
                <label className="sr-only" htmlFor="church">
                  Church
                </label>
                <NativeSelect size="sm" id="church" value={church.id} onChange={(e) => void church.switchTo(e.target.value)}>
                  {church.churches.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </>
            ) : (
              <span className="max-w-40 truncate text-sm text-slate-300">{church.name}</span>
            )}
          </>
        )}
        {/* on a narrow screen the links drop to their own row under the name */}
        <nav aria-label="Main" className="order-last flex w-full gap-0.5 overflow-x-auto sm:order-none sm:ml-2 sm:w-auto">
          {PAGES.filter((page) => !page.admin || mayManage).map((page) => (
            <NavLink key={page.to} to={page.to === '/practice' ? practice : page.to} end={page.end} className={linkClass}>
              {page.label}
              {page.to === '/practice' && playing && (
                <>
                  <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-teal-400" />
                  <span className="sr-only">{title ? `, playing ${title}` : ', playing'}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center">
          <AccountMenu />
        </div>
      </div>
    </header>
  )
}
