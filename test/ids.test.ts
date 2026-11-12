import { describe, expect, it } from 'vitest'
import { ID_PATTERN, newId } from '../shared/ids.ts'

describe('newId', () => {
  it('is 12 url-safe lowercase chars by default', () => {
    for (let i = 0; i < 200; i++) expect(newId()).toMatch(ID_PATTERN)
  })
  it('honours a length', () => {
    expect(newId(5)).toHaveLength(5)
    expect(newId(30)).toHaveLength(30)
  })
  it('does not repeat over 10k ids', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 10_000; i++) seen.add(newId())
    expect(seen.size).toBe(10_000)
  })
})
