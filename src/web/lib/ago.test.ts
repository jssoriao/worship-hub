import { describe, expect, it } from 'vitest'
import { activityLine, ago } from './ago'

const now = new Date(2031, 2, 10, 15, 0)
const at = (y: number, mo: number, d: number, h = 0, mi = 0, sec = 0) => new Date(y, mo, d, h, mi, sec).toISOString()

describe('ago', () => {
  it('counts minutes, hours and days', () => {
    expect(ago(at(2031, 2, 10, 14, 59, 30), now)).toBe('just now')
    expect(ago(at(2031, 2, 10, 14, 48), now)).toBe('12 min ago')
    expect(ago(at(2031, 2, 10, 14, 48), now, { hourly: true })).toBe('within the hour')
    expect(ago(at(2031, 2, 10, 12, 0), now)).toBe('3 h ago')
    expect(ago(at(2031, 2, 9, 9, 0), now)).toBe('yesterday')
    expect(ago(at(2031, 2, 6, 9, 0), now)).toBe('4 days ago')
  })
  it('gives the date after a week, with the year only when it differs', () => {
    expect(ago(at(2031, 1, 20, 9, 0), now)).toBe(new Date(2031, 1, 20, 9).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))
    expect(ago(at(2030, 11, 20, 9, 0), now)).toContain('2030')
  })
})

describe('activityLine', () => {
  it('joins what is known', () => {
    expect(activityLine({ lastActive: at(2031, 2, 10, 13, 0), lastSignIn: at(2031, 2, 7, 9, 0) }, now)).toBe('Active 2 h ago · Signed in 3 days ago')
    expect(activityLine({ lastActive: null, lastSignIn: at(2031, 2, 10, 14, 50) }, now)).toBe('Signed in 10 min ago')
    expect(activityLine({ lastActive: null, lastSignIn: null }, now)).toBe('Not signed in yet')
  })
})
