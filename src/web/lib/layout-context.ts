import { createContext, useContext } from 'react'
import type { Layout, Platform } from './layout'
/** The layout in use (mobile or desktop), the platform, and the switch (see layout.ts for the rules). */
export interface LayoutValue {
  layout: Layout
  /** a phone-sized screen has no switch: it is mobile only */
  canSwitch: boolean
  platform: Platform
  /** picks a layout and remembers it on this device; null forgets the choice */
  choose: (layout: Layout | null) => void
}
/** Outside the provider (tests): the desktop layout, no switch. */
export const LayoutContext = createContext<LayoutValue>({ layout: 'desktop', canSwitch: false, platform: 'other', choose: () => {} })
export const useLayout = () => useContext(LayoutContext)
/** Shorthand for the many places that only ask "is this the mobile layout?". */
export const useIsMobileLayout = () => useContext(LayoutContext).layout === 'mobile'
