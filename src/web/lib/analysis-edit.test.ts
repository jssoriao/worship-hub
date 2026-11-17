import { describe, expect, it } from 'vitest'
import { beatLength, halfBeatChord, halfBeatTime, parseAnalysis, type Chord, type SongAnalysis, type Word } from './analysis'
import { copyBars, lyricsText, removeSectionAt, retimeLines, setAllLyrics, setSectionAt } from './analysis-edit'
import { addLine, addLines, approveLine, removeChordAt, setChordAt, snapToBeat, copySectionChords, copySectionLyrics, sectionLines, doubtfulLines, hasDoubt, retimeWords, setLineText, splitLine, toStored } from './analysis-edit'

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
  it('copies a chord on the half beat to the same place in the other section', () => {
    // Am from the "and" of the last beat of bar 2 (3.25 s) to the end of the section
    const a = copySectionChords(setChordAt(grid(), 3.25, 'Am'), 0, 1)
    expect(names(a)).toEqual(['0-2 C', '2-3 F', '3-3.25 G', '3.25-4 Am', '4-6 C', '6-7 F', '7-7.25 G', '7.25-8 Am', '8-12 E'])
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

describe('tapping the words of a line', () => {
  const starts = (...t: number[]) => t.map((x) => ({ t: x }))
  it('sets each word start, keeps each word length but not past the next word, and moves the line', () => {
    const a = retimeWords(song(), 1, starts(5.2, 5.4))
    expect(a.lines[1]).toEqual({ t: 5.2, end: 5.9, words: [{ w: 'four', t: 5.2, end: 5.4 }, { w: 'five', t: 5.4, end: 5.9 }] })
    expect(a.lines[0]).toEqual(song().lines[0])
  })
  it('keeps the words and their doubts', () => {
    const a = retimeWords(song(), 0, starts(0.5, 1.5, 2.5))
    expect(a.lines[0].words.map((w) => [w.w, w.t, w.doubt])).toEqual([
      ['one', 0.5, undefined],
      ['twu', 1.5, 0.26],
      ['three', 2.5, undefined],
    ])
  })
  it('moves the untapped words by as much as the last tapped one, never before it', () => {
    const a = retimeWords(song(), 0, starts(1.4))
    expect(a.lines[0].words.map((w) => w.t)).toEqual([1.4, 2.4, 3.4])
    const b = retimeWords(song(), 0, starts(1, 2.9))
    expect(b.lines[0].words.map((w) => w.t)).toEqual([1, 2.9, 3.9])
  })
  it('treats a tap before the one before it as the same moment, and ignores extra taps', () => {
    const a = retimeWords(song(), 1, starts(5.5, 5.3, 9))
    expect(a.lines[1].words.map((w) => [w.t, w.end])).toEqual([
      [5.5, 5.5],
      [5.5, 6],
    ])
  })
  it('gives a word with no length (added while retyping) half a second, up to the next word', () => {
    const base = song()
    base.lines[1] = { t: 5, end: 6.5, words: [{ w: 'four', t: 5, end: 5 }, word('five', 6)] }
    const a = retimeWords(base, 1, starts(5, 5.3))
    expect(a.lines[1].words.map((w) => [w.t, w.end])).toEqual([
      [5, 5.3],
      [5.3, 5.8],
    ])
  })
  it('changes nothing without taps or for a line that is not there', () => {
    const a = song()
    expect(retimeWords(a, 1, [])).toBe(a)
    expect(retimeWords(a, 9, starts(1))).toBe(a)
  })
})

describe('holding a tap', () => {
  it('ends a held word at the release, never past the next word', () => {
    const a = retimeWords(song(), 0, [{ t: 0.5, end: 1.4 }, { t: 1.2, end: 3 }, { t: 2 }])
    expect(a.lines[0].words.map((w) => [w.t, w.end])).toEqual([
      [0.5, 1.2],
      [1.2, 2],
      [2, 2.5],
    ])
  })
  it('ends a held line at the release and spreads its words over it', () => {
    const a = addLines(song(), [{ t: 20, end: 23, text: 'aa bb' }])
    const line = a.lines.find((l) => l.words[0].w === 'aa')!
    expect(line.end).toBeCloseTo(23)
    expect(line.words.map((w) => w.end)).toEqual([21.5, 23])
  })
  it('never lets a held line run into the next tapped line', () => {
    const a = addLines(song(), [{ t: 20, end: 30, text: 'aa' }, { t: 22, text: 'bb' }])
    expect(a.lines.find((l) => l.words[0].w === 'aa')!.end).toBeLessThanOrEqual(22)
  })
})

describe('all the lyrics in one box', () => {
  it('writes one line per row, with a blank row before a new section', () => {
    const a = { ...song(), sections: [{ t: 0, end: 4, label: 'Verse' }, { t: 4, end: 12, label: 'Chorus' }] }
    expect(lyricsText(a)).toBe('one twu three\n\nfour five\nsicks seven')
  })
  it('keeps unchanged lines exactly, doubts included', () => {
    const a = setAllLyrics(song(), 'one twu three\n\nfour five\nsicks seven\n')
    expect(a.lines).toEqual(song().lines)
  })
  it('gives a changed line the time of the line it replaces', () => {
    const a = setAllLyrics(song(), 'one twu three\nfour and five\nsicks seven')
    expect(a.lines[1].t).toBe(5)
    expect(a.lines[1].words.map((w) => w.w)).toEqual(['four', 'and', 'five'])
    expect(a.lines[0]).toEqual(song().lines[0])
    expect(a.lines[2]).toEqual(song().lines[2])
  })
  it('puts an added line in the gap between its neighbours, in order', () => {
    const a = setAllLyrics(song(), 'one twu three\nnew line here\nfour five\nsicks seven')
    expect(a.lines).toHaveLength(4)
    expect(a.lines[1].t).toBeGreaterThanOrEqual(3.5)
    expect(a.lines[1].end).toBeLessThanOrEqual(5)
    expect(a.lines.map((l) => l.t)).toEqual([...a.lines.map((l) => l.t)].sort((x, y) => x - y))
  })
  it('takes a whole new song, and drops lines that are gone', () => {
    const a = setAllLyrics(song(), 'aa bb\ncc\ndd ee ff\ngg\nhh')
    expect(a.lines.map((l) => l.words.map((w) => w.w).join(' '))).toEqual(['aa bb', 'cc', 'dd ee ff', 'gg', 'hh'])
    for (let k = 1; k < a.lines.length; k++) expect(a.lines[k].t).toBeGreaterThan(a.lines[k - 1].t)
    expect(setAllLyrics(song(), 'one twu three').lines).toEqual([song().lines[0]])
  })
})
describe('tapping lines', () => {
  it('moves each tapped line to its tap, keeping the spacing of its words', () => {
    const a = retimeLines(song(), 1, [{ t: 4 }])
    expect(a.lines[1].words.map((w) => [w.t, w.end])).toEqual([
      [4, 4.5],
      [5, 5.5],
    ])
    expect(a.lines[0]).toEqual(song().lines[0])
  })
  it('squeezes a line that would run into the next tapped one, and stretches a held one', () => {
    const a = retimeLines(song(), 0, [{ t: 0 }, { t: 1.25 }])
    expect(a.lines[0].end).toBeLessThanOrEqual(1.25)
    const b = retimeLines(song(), 1, [{ t: 5, end: 7.5 }])
    expect(b.lines[1].end).toBeCloseTo(7.5)
  })
  it('moves the later lines along when the last tapped line runs past them', () => {
    const a = retimeLines(song(), 0, [{ t: 7 }])
    expect(a.lines[0].end).toBeCloseTo(9.5)
    expect(a.lines[1].t).toBe(11)
    expect(a.lines[2].t).toBe(14)
    const b = retimeLines(song(), 0, [{ t: 0.5 }])
    expect(b.lines[1]).toEqual(song().lines[1])
  })
})

describe('a chord put where nothing sounds', () => {
  // 4 beats a bar, 0.5 s a beat: bars start at 0, 2, 4, ...
  const base = (): SongAnalysis => ({ ...song(), beats: Array.from({ length: 40 }, (_, i) => ({ t: i * 0.5, n: (i % 4) + 1 })), chords: [] })
  const g = { t: 10, end: 12, basic: 'G', simple: 'G', complex: 'G', bass: '' }
  it('lasts to the end of its bar, or the next chord if that comes first, never to the end of the song', () => {
    expect(setChordAt(base(), 3, 'D').chords.map((c) => [c.t, c.end])).toEqual([[3, 4]])
    expect(setChordAt({ ...base(), chords: [{ ...g, t: 3.5 }] }, 3, 'D').chords.map((c) => [c.t, c.end])).toEqual([
      [3, 3.5],
      [3.5, 12],
    ])
  })
  it('stretches the chord before it, so typing chords one after another holds each until the next', () => {
    const a = setChordAt(setChordAt(base(), 2, 'A'), 6, 'G')
    expect(a.chords.map((c) => [c.t, c.end, c.simple])).toEqual([
      [2, 6, 'A'],
      [6, 8, 'G'],
    ])
    const b = setChordAt({ ...base(), chords: [g] }, 3, 'D')
    expect(b.chords.map((c) => [c.t, c.end])).toEqual([
      [3, 4],
      [10, 12],
    ])
  })
})

describe('copying bars', () => {
  // 4 beats a bar, 0.5 s a beat (2 s a bar), 6 bars; bar 1: C then G on beat 3 and an F on the half beat of beat 4
  const ch = (t: number, end: number, name: string) => ({ t, end, basic: name, simple: name, complex: name, bass: '' })
  const base = (): SongAnalysis => ({ ...song(), beats: Array.from({ length: 24 }, (_, i) => ({ t: i * 0.5, n: (i % 4) + 1 })), chords: [ch(0, 1, 'C'), ch(1, 1.75, 'G'), ch(1.75, 4, 'F'), ch(8, 12, 'Am')] })
  const names = (a: SongAnalysis, from: number, to: number) => a.chords.filter((c) => c.t >= from - 0.01 && c.t < to - 0.01).map((c) => [c.t, c.simple])
  it('copies one bar beat for beat, half beats included, and replaces what was there', () => {
    const a = copyBars(base(), 0, 1, 4)
    expect(names(a, 8, 10)).toEqual([
      [8, 'C'],
      [9, 'G'],
      [9.75, 'F'],
    ])
    // the Am that was there carries on after the copy
    expect(names(a, 10, 12)).toEqual([[10, 'Am']])
    expect(names(a, 0, 2)).toEqual(names(base(), 0, 2))
  })
  it('copies the chord sounding as the bars start, and several bars at once', () => {
    const a = copyBars(base(), 1, 1, 3)
    expect(names(a, 6, 8)).toEqual([[6, 'F']])
    const b = copyBars(base(), 0, 2, 2)
    expect(names(b, 4, 8).map((x) => x[1])).toEqual(['C', 'G', 'F'])
  })
  it('stops at the end of the song and ignores a copy onto itself', () => {
    const a = copyBars(base(), 0, 2, 5)
    expect(Math.max(...a.chords.map((c) => c.end))).toBeLessThanOrEqual(12.01)
    expect(copyBars(base(), 2, 1, 2)).toEqual(base())
  })
})

describe('a section that starts a beat into its bar', () => {
  const base = (): SongAnalysis => ({ ...song(), sections: [{ t: 0, end: 10.5, label: 'Verse' }, { t: 10.5, end: 20, label: 'Chorus' }] })
  it('is renamed and removed by its own start (what the grid now passes), not the bar line', () => {
    expect(removeSectionAt(base(), 10.5).sections).toEqual([{ t: 0, end: 20, label: 'Verse' }])
    expect(setSectionAt(base(), 10.5, 'Bridge').sections.map((s) => s.label)).toEqual(['Verse', 'Bridge'])
    // at the bar line (half a second earlier) it was not found
    expect(removeSectionAt(base(), 10).sections).toHaveLength(2)
  })
})
