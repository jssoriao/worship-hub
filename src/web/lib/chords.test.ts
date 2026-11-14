import { describe, expect, it } from 'vitest'
import { parseKey, semitonesBetween, type Key } from './chords'
const k = (name: string) => parseKey(name) as Key
describe('semitonesBetween', () => {
  it('takes the shortest way between two keys', () => {
    expect(semitonesBetween(k('E'), k('G'))).toBe(3)
    expect(semitonesBetween(k('E'), k('Eb'))).toBe(-1)
    expect(semitonesBetween(k('C'), k('F#'))).toBe(6)
    expect(semitonesBetween(k('C'), k('G'))).toBe(-5)
    expect(semitonesBetween(k('D'), k('D'))).toBe(0)
  })
  it('ignores major or minor', () => {
    expect(semitonesBetween(k('Am'), k('C'))).toBe(3)
  })
})
