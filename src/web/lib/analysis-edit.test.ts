import { describe, expect, it } from 'vitest'
import { parseAnalysis, type SongAnalysis, type Word } from './analysis'
import { approveLine, doubtfulLines, hasDoubt, setLineText, splitLine, toStored } from './analysis-edit'

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
