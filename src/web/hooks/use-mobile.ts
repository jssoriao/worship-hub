// From shadcn/ui (MIT, see THIRD_PARTY_NOTICES.md); adapted: reads the media query with
// useSyncExternalStore, so the first render already knows (no flash of the desktop layout on phones).
import * as React from "react"

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

const subscribe = (onChange: () => void) => {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false)
}
