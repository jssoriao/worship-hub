import { describe, expect, it } from 'vitest'
import { decideLayout, detectPlatform, isPhone, parseLayout, type Screen } from './layout'
const screen = (width: number, height: number, coarse: boolean): Screen => ({ width, height, coarse })
// made-up but real-world sizes (CSS pixels)
const iphone = screen(390, 844, true)
const iphoneSideways = screen(844, 390, true)
const iphoneMaxSideways = screen(932, 430, true)
const miniPortrait = screen(744, 1133, true)
const ipadPortrait = screen(820, 1180, true)
const ipadLandscape = screen(1180, 820, true)
const laptop = screen(1440, 900, false)
const narrowWindow = screen(900, 700, false)
const tinyWindow = screen(600, 700, false)
describe('which layout starts', () => {
  it('phones are mobile only, in either direction, with no switch', () => {
    for (const s of [iphone, iphoneSideways, iphoneMaxSideways, miniPortrait]) {
      expect(isPhone(s)).toBe(true)
      expect(decideLayout(s, null)).toEqual({ layout: 'mobile', canSwitch: false })
      expect(decideLayout(s, 'desktop')).toEqual({ layout: 'mobile', canSwitch: false }) // a saved choice cannot override it
    }
  })
  it('iPads start mobile in both directions and may switch to desktop', () => {
    for (const s of [ipadPortrait, ipadLandscape]) {
      expect(isPhone(s)).toBe(false)
      expect(decideLayout(s, null)).toEqual({ layout: 'mobile', canSwitch: true })
      expect(decideLayout(s, 'desktop')).toEqual({ layout: 'desktop', canSwitch: true })
    }
  })
  it('a mouse screen starts desktop from 1024 px, mobile below it, and may always switch', () => {
    expect(decideLayout(laptop, null)).toEqual({ layout: 'desktop', canSwitch: true })
    expect(decideLayout(screen(1024, 700, false), null).layout).toBe('desktop')
    expect(decideLayout(screen(1023, 700, false), null).layout).toBe('mobile')
    expect(decideLayout(narrowWindow, null)).toEqual({ layout: 'mobile', canSwitch: true })
    expect(decideLayout(laptop, 'mobile')).toEqual({ layout: 'mobile', canSwitch: true })
  })
  it('a desktop window made narrow becomes mobile only, whatever was chosen', () => {
    expect(decideLayout(tinyWindow, 'desktop')).toEqual({ layout: 'mobile', canSwitch: false })
    expect(decideLayout(screen(767, 900, false), null).canSwitch).toBe(false)
    expect(decideLayout(screen(768, 900, false), null).canSwitch).toBe(true)
  })
  it('a short window with a mouse is not a phone', () => {
    expect(isPhone(screen(1200, 400, false))).toBe(false)
  })
  it('reads only the two layouts from storage', () => {
    expect(parseLayout('mobile')).toBe('mobile')
    expect(parseLayout('desktop')).toBe('desktop')
    for (const bad of [null, undefined, '', 'Mobile', 'tablet', 1, {}]) expect(parseLayout(bad)).toBeNull()
  })
})
describe('which platform', () => {
  const nav = (userAgent: string, platform = '', maxTouchPoints = 0) => ({ userAgent, platform, maxTouchPoints })
  it('knows iPhones and iPads, also an iPad that says it is a Mac', () => {
    expect(detectPlatform(nav('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15', 'iPhone', 5))).toBe('ios')
    expect(detectPlatform(nav('Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15', 'iPad', 5))).toBe('ios')
    expect(detectPlatform(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 'MacIntel', 5))).toBe('ios')
  })
  it('does not take a real Mac for an iPad', () => {
    expect(detectPlatform(nav('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', 'MacIntel', 0))).toBe('other')
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' })).toBe('other')
  })
  it('knows Android phones and tablets', () => {
    expect(detectPlatform(nav('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36', 'Linux armv8l', 5))).toBe('android')
    expect(detectPlatform(nav('Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/130 Safari/537.36', 'Linux armv8l', 5))).toBe('android')
  })
  it('calls everything else other', () => {
    expect(detectPlatform(nav('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130', 'Win32', 10))).toBe('other')
    expect(detectPlatform(nav('Mozilla/5.0 (X11; Linux x86_64) Firefox/130', 'Linux x86_64', 0))).toBe('other')
  })
})
