import { describe, expect, it } from 'vitest'
import { DEFAULT_THEME, foregroundOn, luminance, oklchOf, themeFromMetadata, themeVariables } from '../src/shared/theme.ts'

const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

describe('church theme', () => {
  it('reads the theme from metadata, as a JSON string or an object, and drops bad values', () => {
    expect(themeFromMetadata('{"theme":{"brand":"#2563eb","brand2":"#7c3aed","appName":" Our Hub "}}')).toEqual({ brand: '#2563eb', brand2: '#7c3aed', appName: 'Our Hub' })
    expect(themeFromMetadata({ theme: { brand: 'red', brand2: '#12345', appName: '' } })).toEqual({})
    expect(themeFromMetadata('not json')).toEqual({})
    expect(themeFromMetadata(null)).toEqual({})
    // a colour is a colour, not CSS that could break out of the variable
    expect(themeFromMetadata({ theme: { brand: '#000000; background: url(x)' } })).toEqual({})
  })
  it('puts readable text on the brand colour', () => {
    for (const brand of ['#2563eb', '#fde047', '#16a34a', '#111827', '#f97316', '#ffffff', '#000000']) {
      expect(contrast(brand, foregroundOn(brand))).toBeGreaterThanOrEqual(4.5)
    }
    expect(foregroundOn(DEFAULT_THEME.brand)).toBe('#ffffff')
    expect(foregroundOn('#fde047')).not.toBe('#ffffff') // yellow takes dark text
  })
  it('lifts brand-coloured text and rings for a dark brand colour', () => {
    const vars = themeVariables({ brand: '#1e1b4b' })
    expect(vars['--brand']).toBe('#1e1b4b')
    const l = Number(/oklch\(([\d.]+)/.exec(vars['--highlight'])?.[1])
    expect(l).toBeGreaterThanOrEqual(0.8)
    expect(oklchOf('#1e1b4b').l).toBeLessThan(0.4)
  })
  it('falls back to the default colours', () => {
    expect(themeVariables({})['--brand']).toBe(DEFAULT_THEME.brand)
    expect(themeVariables({})['--brand-2']).toBe(DEFAULT_THEME.brand2)
  })
})
