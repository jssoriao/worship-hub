/**
 * Which layout the app shows: mobile (made for a thumb and one hand) or desktop (sidebar, wide timeline).
 * They are two designs, not one design squeezed; the audio engine, analysis and API are shared.
 *
 *   screen                                             layout          switch offered?
 *   under 768 px wide, or a touch screen under 500 px
 *   tall (a phone, also turned sideways)               mobile only     no
 *   anything else with a touch screen (iPads)          mobile first    yes, to desktop
 *   a mouse screen under 1024 px                       mobile first    yes, to desktop
 *   a mouse screen from 1024 px                        desktop first   yes, to mobile
 *
 * The person's choice (`chosen`) is remembered on the device and wins wherever a switch is offered.
 */
export type Layout = 'mobile' | 'desktop'
/** Where the app runs, for the few places that follow the platform's own look (src/web/lib/layout-context.ts). */
export type Platform = 'ios' | 'android' | 'other'
/** Narrower than this is a phone: mobile only. */
export const PHONE_WIDTH = 768
/** A mouse screen from this width starts on the desktop layout. */
export const DESKTOP_WIDTH = 1024
/** A touch screen shorter than this is a phone turned sideways (no iPad is that short). */
export const PHONE_HEIGHT = 500
export interface Screen {
  width: number
  height: number
  /** the main pointer is a finger (`(pointer: coarse)`) */
  coarse: boolean
}
export interface LayoutChoice {
  layout: Layout
  /** whether the person may pick the other layout */
  canSwitch: boolean
}
/** A phone: too narrow, or a touch screen turned sideways. */
export const isPhone = (s: Screen): boolean => s.width < PHONE_WIDTH || (s.coarse && s.height < PHONE_HEIGHT)
export function decideLayout(s: Screen, chosen: Layout | null): LayoutChoice {
  if (isPhone(s)) return { layout: 'mobile', canSwitch: false }
  const first: Layout = s.coarse || s.width < DESKTOP_WIDTH ? 'mobile' : 'desktop'
  return { layout: chosen ?? first, canSwitch: true }
}
/** A saved choice, or null for anything else. */
export const parseLayout = (value: unknown): Layout | null => (value === 'mobile' || value === 'desktop' ? value : null)
/**
 * The platform from the browser's own words. iPadOS says it is a Mac, but a Mac has no touch points, so a "Mac"
 * with several is an iPad. Android tablets and phones both say Android.
 */
export function detectPlatform(nav: { userAgent: string; platform?: string; maxTouchPoints?: number }): Platform {
  const ua = nav.userAgent
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios'
  if ((/Macintosh/.test(ua) || nav.platform === 'MacIntel') && (nav.maxTouchPoints ?? 0) > 1) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'other'
}
