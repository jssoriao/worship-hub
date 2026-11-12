import { useEffect, useRef } from 'react'
import { Route, Routes, useLocation } from 'react-router'
import { NavBar } from './components/NavBar'
import ArrangePage from './pages/ArrangePage'
import ChartsPage from './pages/ChartsPage'
import HomePage from './pages/HomePage'
import MembersPage from './pages/MembersPage'
import NotFoundPage from './pages/NotFoundPage'
import PracticePage from './pages/PracticePage'

const TITLES: Record<string, string> = { '/': 'Worship Hub', '/practice': 'Practice', '/charts': 'Charts', '/arrange': 'Arrange', '/members': 'Members' }

/**
 * The shell: the nav bar and the page for the address.
 *
 * Practice is the one page that is never unmounted. It stays in the page, hidden, while another
 * page shows, so a song keeps playing (with its mix) while you read a chart. Everything else is
 * mounted only while it is shown.
 */
export default function App() {
  const { pathname } = useLocation()
  const onPractice = pathname === '/practice' || pathname.startsWith('/practice/')
  const main = useRef<HTMLElement>(null)
  const shownPath = useRef<string | null>(null)

  useEffect(() => {
    const name = TITLES[pathname] ?? (onPractice ? 'Practice' : 'Not found')
    document.title = pathname === '/' ? name : `${name} · Worship Hub`
    // Moving to another page starts it at the top and moves a screen reader to it (a link click
    // would otherwise leave focus on a link that is no longer on screen). Opening the app on a
    // page is not a move.
    const moved = shownPath.current !== null && shownPath.current !== pathname
    shownPath.current = pathname
    if (!moved) return
    window.scrollTo(0, 0)
    main.current?.focus({ preventScroll: true })
  }, [pathname, onPractice])

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-30 focus:rounded-md focus:bg-teal-600 focus:px-3 focus:py-2 focus:text-sm focus:text-white"
      >
        Skip to content
      </a>
      <NavBar />
      <main id="main" ref={main} tabIndex={-1} className="outline-none">
        <div hidden={!onPractice}>
          <PracticePage />
        </div>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/charts" element={<ChartsPage />} />
          <Route path="/arrange" element={<ArrangePage />} />
          <Route path="/members" element={<MembersPage />} />
          {/* shown by the PracticePage above */}
          <Route path="/practice/*" element={null} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
    </div>
  )
}
