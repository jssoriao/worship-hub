import { describe, expect, it } from 'vitest'
import { chordNumber, numberChord, parseKey, semitonesBetween, type Key } from './chords'
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
describe('chords as Nashville numbers in Practice', () => {
  it('numbers every chord in the song key, with the bass folded in, and leaves no-chords empty', async () => {
    const { numberAnalysis } = await import('./analysis')
    const chord = (basic: string, simple: string, complex: string, bass = '') => ({ t: 0, end: 1, basic, simple, complex, bass })
    const a = { key: 'A major', bpm: 100, beats: [], sections: [], lines: [], chords: [chord('A', 'A', 'Aadd9'), chord('E', 'E', 'E', 'G#'), chord('F#m', 'F#m7', 'F#m7'), chord('N', 'N', 'N')] }
    const n = numberAnalysis(a)
    expect(n.chords.map((c) => [c.basic, c.simple, c.complex, c.bass])).toEqual([
      ['1', '1', '1add9', ''],
      ['5', '5/7', '5/7', ''],
      ['6m', '6m7', '6m7', ''],
      ['', '', '', ''],
    ])
    // a minor key counts from its relative major, as Charts does: Em in E minor is 6m
    expect(numberAnalysis({ ...a, key: 'E minor', chords: [chord('Em', 'Em', 'Em')] }).chords[0].basic).toBe('6m')
    // no key: unchanged
    const noKey = { ...a, key: '' }
    expect(numberAnalysis(noKey)).toBe(noKey)
  })
})
describe('numbers typed back into chords', () => {
  it('turns a Nashville number into the chord in the key', () => {
    expect(numberChord('1', k('A'))).toBe('A')
    expect(numberChord('6m7', k('A'))).toBe('F#m7')
    expect(numberChord('5/7', k('A'))).toBe('E/G#')
    expect(numberChord('4maj7', k('A'))).toBe('Dmaj7')
    expect(numberChord('2', k('D'))).toBe('E')
    expect(numberChord('12', k('D'))).toBe('D2')
  })
  it('spells as the key does, or as the accidental says', () => {
    expect(numberChord('4', k('F'))).toBe('Bb')
    expect(numberChord('b7', k('C'))).toBe('Bb')
    expect(numberChord('#4', k('C'))).toBe('F#')
    expect(numberChord('b3', k('A'))).toBe('C')
  })
  it('counts a minor key from its relative major, as chordNumber does', () => {
    expect(numberChord('6m', k('Em'))).toBe('Em')
    expect(chordNumber('Em', k('Em'))).toBe('6m')
  })
  it('round-trips every chord of a key through its number', () => {
    for (const c of ['A', 'Bm', 'C#m7', 'Dmaj7', 'E/G#', 'F#m', 'Esus4', 'A/C#']) expect(numberChord(chordNumber(c, k('A')), k('A'))).toBe(c)
  })
  it('leaves what is not a number to the caller', () => {
    expect(numberChord('D/F#', k('A'))).toBeNull()
    expect(numberChord('', k('A'))).toBeNull()
    expect(numberChord('8', k('A'))).toBeNull()
  })
})
