import { describe, expect, it } from 'vitest'
import { beatLength, halfBeatChord, halfBeatTime, parseAnalysis, type Chord, type SongAnalysis, type Word } from './analysis'
import { addLine, addLines, approveLine, removeChordAt, setChordAt, snapToBeat, copySectionChords, copySectionLyrics, sectionLines, doubtfulLines, hasDoubt, setLineText, splitLine, toStored } from './analysis-edit'

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

// 4 beats a bar, one beat every 0.9 s from 0.5 s (a pickup beat first), made-up words
const gridSong = (lines: SongAnalysis['lines'] = []): SongAnalysis => ({
  key: 'Db major',
  bpm: 67,
  beats: Array.from({ length: 40 }, (_, i) => ({ t: 0.5 + i * 0.9, n: ((i + 3) % 4) + 1 })),
  chords: [],
  sections: [],
  lines,
})
describe('adding lyric lines', () => {
  it('snaps a moment to the nearest beat, and leaves it alone when the song has no beats', () => {
    const a = gridSong()
    expect(snapToBeat(a, 3.0)).toBeCloseTo(3.2) // between 2.3 and 3.2, nearer 3.2
    expect(snapToBeat(a, 2.6)).toBeCloseTo(2.3)
    expect(snapToBeat(a, -4)).toBeCloseTo(0.5)
    expect(snapToBeat(a, 999)).toBeCloseTo(0.5 + 39 * 0.9)
    expect(snapToBeat({ ...a, beats: [] }, 3.33)).toBe(3.33)
  })
  it('puts a line on a beat, its words spread over the time by length, inside two bars', () => {
    const a = addLine(gridSong(), 3.0, '  one   three  two ')
    expect(a.lines).toHaveLength(1)
    const line = a.lines[0]
    expect(line.t).toBeCloseTo(3.2)
    expect(line.words.map((w) => w.w)).toEqual(['one', 'three', 'two'])
    // contiguous, increasing, the longer word gets the longer share
    expect(line.words[0].t).toBeCloseTo(3.2)
    expect(line.words[0].end).toBeCloseTo(line.words[1].t)
    expect(line.words[1].end - line.words[1].t).toBeGreaterThan(line.words[0].end - line.words[0].t)
    expect(line.end).toBe(line.words[2].end)
    expect(line.end).toBeLessThanOrEqual(3.2 + 2 * 4 * 0.9 + 0.01)
    expect(line.words.every((w) => w.doubt === undefined)).toBe(true)
  })
  it('ends a line where the next existing line starts, and keeps the lines in order', () => {
    const a = addLine(gridSong([{ t: 5.0, end: 7, words: [word('later', 5)] }]), 3.2, 'one two three four five six')
    expect(a.lines.map((l) => l.words[0].w)).toEqual(['one', 'later'])
    expect(a.lines[0].end).toBeLessThanOrEqual(5.0)
    // and one added before the first existing line sorts first, one after sorts last
    expect(addLine(a, 20, 'last').lines.map((l) => l.words[0].w)).toEqual(['one', 'later', 'last'])
    expect(addLine(a, 0.4, 'first').lines[0].words[0].w).toBe('first')
  })
  it('adds several lines at once: each runs until the next, the last for two bars', () => {
    const a = addLines(gridSong(), [
      { t: 9.4, text: 'third line' },
      { t: 2.3, text: 'first line' },
      { t: 5.9, text: 'second line' },
      { t: 12, text: '   ' },
    ])
    expect(a.lines.map((l) => l.words.map((w) => w.w).join(' '))).toEqual(['first line', 'second line', 'third line'])
    expect(a.lines.map((l) => l.t)).toEqual([2.3, 5.9, 9.5].map((x) => expect.closeTo(x, 5))) // 9.4 snaps to the 9.5 beat
    expect(a.lines[0].end).toBeLessThanOrEqual(5.9)
    expect(a.lines[1].end).toBeLessThanOrEqual(9.5)
    expect(a.lines[2].end).toBeGreaterThan(9.5)
  })
  it('does not stack two lines on the same beat, and does nothing for empty text', () => {
    const a = addLines(gridSong(), [
      { t: 3.2, text: 'one' },
      { t: 3.3, text: 'two' },
    ])
    expect(a.lines[1].t).toBeGreaterThan(a.lines[0].t)
    const empty = gridSong()
    expect(addLine(empty, 3, '   ')).toBe(empty)
  })
  it('works on a song with no beats and no lines, and what it makes is stored and read back', () => {
    const a = addLine({ ...gridSong(), beats: [] }, 1.25, 'only line here')
    expect(a.lines[0].t).toBe(1.25)
    expect(parseAnalysis(JSON.parse(JSON.stringify(toStored(a)))).lines[0].words.map((w) => w.w)).toEqual(['only', 'line', 'here'])
  })
})

// chords between two beats (the "and" of a beat): a 4-beat bar every 0.5 s, made-up chords
const mk = (t: number, end: number, name: string): Chord => ({ t, end, basic: name, simple: name, complex: name, bass: '' })
const beatSong = (chords: Chord[]): SongAnalysis => ({
  key: 'D major',
  bpm: 120,
  beats: Array.from({ length: 8 }, (_, i) => ({ t: i * 0.5, n: (i % 4) + 1 })),
  chords,
  sections: [],
  lines: [],
})
describe('chords on the half beat', () => {
  it('knows how long a beat is and where its middle is, also for the last beat', () => {
    const a = beatSong([])
    expect(beatLength(a.beats, 0)).toBeCloseTo(0.5)
    expect(beatLength(a.beats, 7)).toBeCloseTo(0.5)
    expect(halfBeatTime(a.beats, 1)).toBeCloseTo(0.75)
    expect(beatLength([{ t: 1, n: 1 }], 0)).toBe(0.5)
  })
  it('finds a chord that starts in the middle of a beat, and none that start on the beat', () => {
    // D on beats 1-2, G from the "and" of beat 2 (0.75 s) to the end of bar 1
    const a = beatSong([mk(0, 0.75, 'D'), mk(0.75, 2, 'G'), mk(2, 4, 'A')])
    expect(halfBeatChord(a, a.beats, 1)?.complex).toBe('G')
    for (const i of [0, 2, 3, 4, 5]) expect(halfBeatChord(a, a.beats, i)).toBeUndefined()
  })
  it('counts a chord within 30% of a beat as on that beat, as chords found by listening are', () => {
    const a = beatSong([mk(0, 0.6, 'D'), mk(0.6, 1, 'G'), mk(1.1, 2, 'A')]) // 0.6 = 20% into beat 2, 1.1 = 20% into beat 3
    expect(halfBeatChord(a, a.beats, 1)).toBeUndefined()
    expect(halfBeatChord(a, a.beats, 2)).toBeUndefined()
  })
  it('puts a chord there with setChordAt, splitting the one that sounds, and takes it away again', () => {
    const a = beatSong([mk(0, 2, 'D')])
    const put = setChordAt(a, halfBeatTime(a.beats, 1), 'G')
    expect(put.chords.map((c) => [c.t, c.end, c.complex])).toEqual([
      [0, 0.75, 'D'],
      [0.75, 2, 'G'],
    ])
    expect(halfBeatChord(put, put.beats, 1)?.complex).toBe('G')
    const gone = removeChordAt(put, 0.75)
    expect(gone.chords.map((c) => [c.t, c.end, c.complex])).toEqual([[0, 2, 'D']])
    expect(halfBeatChord(gone, gone.beats, 1)).toBeUndefined()
  })
  it('removes only a chord that starts at that moment', () => {
    const a = beatSong([mk(0, 1, 'D'), mk(1, 2, 'G')])
    expect(removeChordAt(a, 0.5)).toBe(a)
    expect(removeChordAt(a, 1).chords.map((c) => c.complex)).toEqual(['D'])
    expect(removeChordAt(a, 1).chords[0].end).toBe(2) // the chord before carries on
    expect(removeChordAt(a, 0).chords.map((c) => c.complex)).toEqual(['G']) // the first chord has no chord before it
  })
})
