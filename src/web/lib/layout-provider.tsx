import { useCallback, useLayoutEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { decideLayout, detectPlatform, parseLayout, type Layout, type Screen } from './layout'
import { LayoutContext } from './layout-context'
const STORAGE_KEY = 'worship-hub:layout'
const COARSE = '(pointer: coarse)'
/** The size and pointer of the screen, as one string so React can tell when it changed. */
const readScreen = () => `${window.innerWidth}x${window.innerHeight}${window.matchMedia(COARSE).matches ? 'c' : 'm'}`
const parseScreen = (s: string): Screen => {
  const [, w, h, p] = /^(\d+)x(\d+)([cm])$/.exec(s)!
  return { width: Number(w), height: Number(h), coarse: p === 'c' }
}
function subscribe(onChange: () => void) {
  const coarse = window.matchMedia(COARSE)
  window.addEventListener('resize', onChange)
  window.addEventListener('orientationchange', onChange)
  coarse.addEventListener('change', onChange)
  return () => {
    window.removeEventListener('resize', onChange)
    window.removeEventListener('orientationchange', onChange)
    coarse.removeEventListener('change', onChange)
  }
}
function savedChoice(): Layout | null {
  try {
    return parseLayout(localStorage.getItem(STORAGE_KEY))
  } catch {
    return null // storage blocked: the choice is just not remembered
  }
}
/**
 * Decides mobile or desktop from the screen (layout.ts) and the person's remembered choice, and writes it on
 * the page as `data-layout` and `data-platform`, which the `mobile:`, `desktop:`, `ios:` and `android:` variants
 * in index.css read, so a design can differ without a component knowing the platform.
 */
export function LayoutProvider({ children }: { children: ReactNode }) {
  const screen = parseScreen(useSyncExternalStore(subscribe, readScreen, () => '1280x800m'))
  const [chosen, setChosen] = useState<Layout | null>(savedChoice)
  const platform = useMemo(() => detectPlatform({ userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints }), [])
  const { layout, canSwitch } = decideLayout(screen, chosen)
  const choose = useCallback((next: Layout | null) => {
    setChosen(next)
    try {
      if (next) localStorage.setItem(STORAGE_KEY, next)
      else localStorage.removeItem(STORAGE_KEY)
    } catch {
      // storage blocked
    }
  }, [setChosen])
  // before the first paint, so there is no flash of the wrong layout
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.layout = layout
    root.dataset.platform = platform
  }, [layout, platform])
  const value = useMemo(() => ({ layout, canSwitch, platform, choose }), [layout, canSwitch, platform, choose])
  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>
}
