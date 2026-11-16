import { describe, expect, it } from 'vitest'
import { daysUntil, isHttps, linkText, move, splitServices, today, whenLabel } from './services'
describe('how soon a service is', () => {
  it('counts whole days, across months, years and leap days', () => {
    expect(daysUntil('2031-03-02', '2031-03-02')).toBe(0)
    expect(daysUntil('2031-03-03', '2031-03-02')).toBe(1)
    expect(daysUntil('2031-03-09', '2031-03-02')).toBe(7)
    expect(daysUntil('2031-04-01', '2031-03-31')).toBe(1)
    expect(daysUntil('2032-01-01', '2031-12-31')).toBe(1)
    expect(daysUntil('2032-03-01', '2032-02-28')).toBe(2) // 2032 is a leap year
    expect(daysUntil('2031-03-01', '2031-03-02')).toBe(-1)
  })
  it('says it in words within the week, and with the date after that', () => {
    expect(whenLabel('2031-03-02', '2031-03-02')).toBe('Today')
    expect(whenLabel('2031-03-03', '2031-03-02')).toBe('Tomorrow')
    expect(whenLabel('2031-03-05', '2031-03-02')).toBe('In 3 days')
    expect(whenLabel('2031-03-08', '2031-03-02')).toBe('In 6 days')
    expect(whenLabel('2031-03-09', '2031-03-02')).toBe('Sun, Mar 9, 2031')
  })
})
describe('services helpers', () => {
  it('writes today in the device\'s own day', () => {
    expect(today(new Date(2031, 2, 2, 23, 59))).toBe('2031-03-02')
    expect(today(new Date(2031, 0, 5, 0, 1))).toBe('2031-01-05')
  })
  it('splits upcoming (soonest first, today included) from past (latest first)', () => {
    const list = [
      { date: '2031-03-09', time: '18:00' },
      { date: '2031-03-09', time: null },
      { date: '2031-03-02', time: null },
      { date: '2031-02-23', time: null },
      { date: '2031-02-16', time: '09:00' },
    ]
    const { upcoming, past } = splitServices(list, '2031-03-02')
    expect(upcoming.map((s) => [s.date, s.time])).toEqual([['2031-03-02', null], ['2031-03-09', null], ['2031-03-09', '18:00']])
    expect(past.map((s) => s.date)).toEqual(['2031-02-23', '2031-02-16'])
  })
  it('moves a line, clamped at the ends', () => {
    expect(move(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
    expect(move(['a', 'b', 'c'], 2, -2)).toEqual(['c', 'a', 'b'])
    const same = ['a', 'b']
    expect(move(same, 0, -1)).toBe(same)
    expect(move(same, 1, 5)).toBe(same)
  })
  it('shows a link by label, else by site', () => {
    expect(linkText({ url: 'https://www.youtube.com/watch?v=x', label: '' })).toBe('youtube.com')
    expect(linkText({ url: 'https://youtu.be/x', label: 'Original' })).toBe('Original')
  })
  it('accepts only https links', () => {
    expect(isHttps('https://youtu.be/x')).toBe(true)
    expect(isHttps(' https://youtu.be/x ')).toBe(true)
    for (const v of ['http://a.com', 'javascript:alert(1)', 'youtu.be/x', '']) expect(isHttps(v)).toBe(false)
  })
})
