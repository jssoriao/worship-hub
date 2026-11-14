import { describe, expect, it } from 'vitest'
import { parseAnalysis, type SongAnalysis, type Word } from './analysis'
import { approveLine, copySectionChords, copySectionLyrics, sectionLines, doubtfulLines, hasDoubt, setLineText, splitLine, toStored } from './analysis-edit'

// made-up words only
const word = (w: string, t: number, doubt?: number): Word => ({ w, t, end: t + 0.5, ...(doubt === undefined ? {} : { doubt }) })
const song = (): SongAnalysis => ({
  key: 'D major',
  bpm: 120,
  beats: [],
  chords: [],
  sections: [],
  lines: [
    { t: 1, end: 3.5, words: [word('one', 1), word('twu', 2, 0.26), word('three', 3)] },
    { t: 5, end: 6.5, words: [word('four', 5), word('five', 6)] },
    { t: 8, end: 9.5, words: [word('sicks', 8, 0.11), word('seven', 9, 0.3)] },
  ],
})

describe('words the speech-to-text was unsure of', () => {
  it('are stored as a fourth number (percent) and read back, and only for those words', () => {
    const stored = toStored(song())
    expect(stored.lines[0][2]).toEqual([
      ['one', 1000, 1500],
      ['twu', 2000, 2500, 26],
      ['three', 3000, 3500],
    ])
    expect(parseAnalysis(JSON.parse(JSON.stringify(stored)))).toEqual(song())
  })

  it('reads an analysis stored before they were kept', () => {
    const a = parseAnalysis({ lines: [[1000, 2000, [['old', 1000, 1500]]]] })
    expect(a.lines[0].words).toEqual([{ w: 'old', t: 1, end: 1.5 }])
    expect(doubtfulLines(a)).toBe(0)
  })

  it('count as lines to check', () => {
    expect(doubtfulLines(song())).toBe(2)
    expect(hasDoubt(song().lines[1])).toBe(false)
  })

  it('stop being flagged when the line is approved, and nothing else changes', () => {
    const a = approveLine(song(), 0)
    expect(hasDoubt(a.lines[0])).toBe(false)
    expect(a.lines[0].words.map((w) => [w.w, w.t, w.end])).toEqual([
      ['one', 1, 1.5],
      ['twu', 2, 2.5],
      ['three', 3, 3.5],
    ])
    expect(doubtfulLines(a)).toBe(1)
    expect(approveLine(a, 0)).toBe(a)
    expect(approveLine(a, 9)).toBe(a)
  })

  it('stop being flagged when the line is retyped, even for the words that stay', () => {
    const a = setLineText(song(), 2, 'six seven')
    expect(hasDoubt(a.lines[2])).toBe(false)
    expect(a.lines[2].words.map((w) => [w.w, w.t])).toEqual([
      ['six', 8],
      ['seven', 9],
    ])
    // other lines are not touched
    expect(hasDoubt(a.lines[0])).toBe(true)
  })

  it('stay with their words when a line is split', () => {
    const a = splitLine(song(), 0, 2)
    expect(a.lines.map(hasDoubt)).toEqual([true, false, false, true])
  })
})

// made-up song: 2 s per bar of four beats (0.5 s each)
const chord = (t: number, end: number, name: string) => ({ t, end, basic: name, simple: name, complex: name, bass: '' })
const grid = (): SongAnalysis => ({
  key: 'C major',
  bpm: 120,
  beats: Array.from({ length: 24 }, (_, i) => ({ t: i * 0.5, n: (i % 4) + 1 })),
  chords: [chord(0, 2, 'C'), chord(2, 3, 'F'), chord(3, 4, 'G'), chord(4, 6, 'Am'), chord(6, 8, 'Dm'), chord(8, 12, 'E')],
  sections: [
    { t: 0, end: 4, label: 'A' },
    { t: 4, end: 8, label: 'B' },
    { t: 8, end: 12, label: 'C' },
  ],
  lines: [
    { t: 0.5, end: 3.5, words: [word('aa', 0.5), word('bb', 2), word('cc', 3)] },
    { t: 4.5, end: 7.5, words: [word('dd', 4.5), word('ee', 6), word('ff', 7)] },
    { t: 8.5, end: 11, words: [word('gg', 8.5), word('hh', 10)] },
  ],
})
const names = (a: SongAnalysis) => a.chords.map((c) => `${c.t}-${c.end} ${c.simple}`)
describe('copying chords', () => {
  it('copies a section bar for bar onto another', () => {
    const a = copySectionChords(grid(), 0, 1)
    expect(names(a)).toEqual(['0-2 C', '2-3 F', '3-4 G', '4-6 C', '6-7 F', '7-8 G', '8-12 E'])
    expect(a.chords[3].t).toBe(4)
  })
  it('stops at the end of a shorter section', () => {
    const a = grid()
    a.sections[1] = { t: 4, end: 6, label: 'B' }
    expect(names(copySectionChords(a, 0, 1))).toEqual(['0-2 C', '2-3 F', '3-4 G', '4-6 C', '6-8 Dm', '8-12 E'])
  })
  it('keeps the rest of a longer section', () => {
    const a = grid()
    a.sections[0] = { t: 0, end: 2, label: 'A' }
    expect(names(copySectionChords(a, 0, 1))).toEqual(['0-2 C', '2-3 F', '3-4 G', '4-6 C', '6-8 Dm', '8-12 E'])
  })
  it('does nothing for the same section or a missing one', () => {
    const a = grid()
    expect(copySectionChords(a, 1, 1)).toBe(a)
    expect(copySectionChords(a, 1, 7)).toBe(a)
  })
})
describe('copying lyrics', () => {
  const two = (): SongAnalysis => ({
    ...grid(),
    sections: [
      { t: 0, end: 4, label: 'A' },
      { t: 4, end: 8, label: 'B' },
      { t: 8, end: 12, label: 'C' },
    ],
    lines: [
      { t: 0.5, end: 1.5, words: [word('aa', 0.5), word('bb', 1)] },
      { t: 2, end: 3.5, words: [word('cc', 2), word('dd', 3)] },
      { t: 4.5, end: 5.5, words: [word('x', 4.5, 0.2), word('y', 5)] },
      { t: 6, end: 7.5, words: [word('z', 6), word('w', 7)] },
      { t: 8.5, end: 9.5, words: [word('q', 8.5)] },
    ],
  })
  it('finds the lines of each section', () => {
    expect([0, 1, 2].map((k) => sectionLines(two(), k))).toEqual([[0, 1], [2, 3], [4]])
  })
  it('puts the words of one section on another and keeps every line where it is', () => {
    const a = copySectionLyrics(two(), 0, 1)
    expect(a.lines.slice(2, 4).map((l) => l.words.map((w) => w.w))).toEqual([['aa', 'bb'], ['cc', 'dd']])
    expect(a.lines.slice(2, 4).map((l) => [l.t, l.end])).toEqual([[4.5, 5.5], [6, 7.5]])
    expect(a.lines.slice(0, 2)).toEqual(two().lines.slice(0, 2))
    expect(hasDoubt(a.lines[2])).toBe(false)
  })
  it('does nothing when the sections have a different number of lines', () => {
    const a = two()
    expect(copySectionLyrics(a, 0, 2)).toBe(a)
  })
  it('does nothing for the same section', () => {
    const a = two()
    expect(copySectionLyrics(a, 1, 1)).toBe(a)
  })
})
