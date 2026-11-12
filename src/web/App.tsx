import { useEffect, useRef, useState } from 'react'
import { Route, Routes, useLocation } from 'react-router'
import { SidebarInset, SidebarProvider, useSidebar } from '@/components/ui/sidebar'
import { AppSidebar } from './components/AppSidebar'
import { PAGES } from './lib/pages'
import { useNowPlaying } from './lib/now-playing-context'
import { PlayerSlotContext } from './lib/player-slot'
import ArrangePage from './pages/ArrangePage'
import ChartsPage from './pages/ChartsPage'
import HomePage from './pages/HomePage'
import MembersPage from './pages/MembersPage'
import NotFoundPage from './pages/NotFoundPage'
import PracticePage from './pages/PracticePage'

/** The bottom dock for the play bar: from the sidebar's edge to the right edge of the window. */
function PlayerDock({ onSlot }: { onSlot: (el: HTMLElement | null) => void }) {
  const { state, isMobile } = useSidebar()
  const left = isMobile ? '0px' : state === 'expanded' ? 'var(--sidebar-width)' : 'var(--sidebar-width-icon)'
  return <div ref={onSlot} data-player-dock="" className="fixed right-0 bottom-0 z-20 transition-[left] duration-200 ease-linear" style={{ left }} />
}

/**
 * The shell: the sidebar, the page for the address, and the play bar docked at the bottom.
 *
 * Practice is the one page that is never unmounted. It stays in the page, hidden, while another
 * page shows, so a song keeps playing (with its mix) while you read a chart; its play bar is drawn
 * into the dock, so it stays in reach on every page. Everything else is mounted only while shown.
 */
export default function App() {
  const { pathname } = useLocation()
  const onPractice = pathname === '/practice' || pathname.startsWith('/practice/')
  const main = useRef<HTMLElement>(null)
  const shownPath = useRef<string | null>(null)
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const now = useNowPlaying()
  useEffect(() => {
    const name = PAGES.find((p) => p.to === pathname)?.label ?? (onPractice ? 'Practice' : 'Not found')
    document.title = pathname === '/' ? 'Worship Hub' : `${name} · Worship Hub`
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
    <PlayerSlotContext.Provider value={slot}>
      <SidebarProvider defaultOpen={!/(?:^|; )sidebar_state=false/.test(document.cookie)}>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:text-primary-foreground"
        >
          Skip to content
        </a>
        <AppSidebar />
        {/* room for the dock when a song is open (Practice makes its own) */}
        <SidebarInset id="main" ref={main} tabIndex={-1} className={`min-w-0 bg-transparent outline-none ${now.title && !onPractice ? 'pb-28 md:pb-20' : ''}`}>
          <div hidden={!onPractice}>
            <PracticePage />
          </div>
          {/* a plain block, so pages centred with mx-auto keep their full width (the inset is a flex column) */}
          <div>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/charts" element={<ChartsPage />} />
            <Route path="/arrange" element={<ArrangePage />} />
            <Route path="/members" element={<MembersPage />} />
            {/* shown by the PracticePage above */}
            <Route path="/practice/*" element={null} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
          </div>
        </SidebarInset>
        <PlayerDock onSlot={setSlot} />
      </SidebarProvider>
    </PlayerSlotContext.Provider>
  )
}
