import { Link, NavLink } from 'react-router'
import { useChurch } from '../lib/church-context'
import { practiceLink, useNowPlaying } from '../lib/now-playing-context'
import { Select } from './Select'
import { SignOutButton } from './AuthGate'

/** The pages of the app, in the order they appear in the bar. */
const PAGES = [
  { to: '/', label: 'Home', end: true },
  { to: '/practice', label: 'Practice', end: false },
  { to: '/charts', label: 'Charts', end: false },
  { to: '/arrange', label: 'Arrange', end: false },
] as const

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `relative inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-teal-400 ${
    isActive ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'
  }`

export function NavBar() {
  const now = useNowPlaying()
  const { playing, title } = now
  const church = useChurch()
  // back to Practice with the song that is open there (no song in the address means none)
  const practice = practiceLink(now, church.id)
  return (
    <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2">
        <Link
          to="/"
          className="rounded-md text-base font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
        >
          Worship Hub
        </Link>
        {/* on a narrow screen the links drop to their own row under the name */}
        <nav aria-label="Main" className="order-last flex w-full gap-1 sm:order-none sm:w-auto">
          {PAGES.map((page) => (
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
        <div className="flex items-center gap-2">
          {church.churches.length > 1 ? (
            <>
              <label className="sr-only" htmlFor="church">
                Church
              </label>
              <Select compact id="church" value={church.id} onChange={(e) => void church.switchTo(e.target.value)}>
                {church.churches.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </>
          ) : (
            church.name && <span className="text-xs text-slate-400">{church.name}</span>
          )}
          <SignOutButton />
        </div>
      </div>
    </header>
  )
}
