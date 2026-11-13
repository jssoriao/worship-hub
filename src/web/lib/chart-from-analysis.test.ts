import { describe, expect, it } from 'vitest'
import type { Chord, Line, SongAnalysis } from './analysis'
import { parseChart } from './chart'
import { chartFromAnalysis } from './chart-from-analysis'
import { respellChord } from './chords'

// made-up words and chords only

/** A line whose words start one second apart from `t`, each lasting `each` seconds. */
const line = (t: number, text: string, each = 0.8): Line => {
  const words = text.split(' ').map((w, i) => ({ w, t: t + i, end: t + i + each }))
  return { t, end: words[words.length - 1].end, words }
}
const chord = (t: number, end: number, simple: string, extra: Partial<Chord> = {}): Chord => ({
  t,
  end,
  basic: simple.replace(/7|sus4/, ''),
  simple,
  complex: simple,
  bass: '',
  ...extra,
})
const song = (over: Partial<SongAnalysis> = {}): SongAnalysis => ({ key: 'D major', bpm: 120, beats: [], chords: [], sections: [], lines: [], ...over })

describe('chartFromAnalysis', () => {
  it('writes the header, a block per section with its cue, and chords in front of the words they change on', () => {
    const text = chartFromAnalysis(
      song({
        sections: [
          { t: 0, end: 8, label: 'Intro' },
          { t: 8, end: 20, label: 'Verse' },
          { t: 20, end: 30, label: 'Chorus' },
        ],
        chords: [chord(0, 2, 'D'), chord(2, 4, 'G'), chord(4, 6, 'A'), chord(6, 10.5, 'D'), chord(10.5, 20, 'G'), chord(20, 30, 'A7')],
        lines: [line(8, 'one two three four'), line(20, 'five six')],
      }),
      { title: 'Made Up Song', artist: 'Nobody', level: 'simple' },
    )
    expect(text).toBe(
      [
        '{title: Made Up Song}',
        '{artist: Nobody}',
        '{key: D}',
        '',
        '{comment: Intro}',
        '{cue: 0:00.0}',
        '[D] [G] [A] [D]',
        '',
        '{start_of_verse: Verse}',
        '{cue: 0:08.0}',
        '[D]one two [G]three four',
        '{end_of_verse}',
        '',
        '{start_of_chorus: Chorus}',
        '{cue: 0:20.0}',
        '[A7]five six',
        '{end_of_chorus}',
        '',
      ].join('\n'),
    )
    // and it reads back as a chart tied to the stems
    const chart = parseChart(text)
    expect(chart.sections.map((s) => [s.label, s.t])).toEqual([
      ['Intro', 0],
      ['Verse', 8],
      ['Chorus', 20],
    ])
    expect(chart.sections[1].lines[0]).toEqual([
      { chord: 'D', text: 'one two ' },
      { chord: 'G', text: 'three four' },
    ])
  })

  it('spells chords for the key', () => {
    const text = chartFromAnalysis(
      song({ key: 'Ab major', chords: [chord(0, 1, 'G#'), chord(1, 2, 'C#m7', { bass: 'G#' })], lines: [line(0, 'la lo')] }),
      { level: 'simple' },
    )
    expect(text).toContain('{key: Ab}')
    expect(text).toContain('[Ab]la [Dbm7/Ab]lo')
  })

  it('follows the chord level', () => {
    const a = song({ chords: [chord(0, 1, 'Gsus4', { bass: 'B' })], lines: [line(0, 'la')] })
    expect(chartFromAnalysis(a, { level: 'basic' })).toContain('[G]la')
    expect(chartFromAnalysis(a, { level: 'simple' })).toContain('[Gsus4/B]la')
  })

  it('puts a chord played just before a word on that word, and the chord already sounding on the first word', () => {
    const text = chartFromAnalysis(
      song({ chords: [chord(0, 9.9, 'D'), chord(9.9, 14, 'G')], lines: [line(5, 'aa bb cc dd'), line(10, 'ee ff')] }),
    )
    expect(text).toContain('[D]aa bb cc dd\n[G]ee ff')
  })

  it('writes the chords between sung lines on their own lines, a few per line', () => {
    const chords = ['D', 'G', 'A', 'Bm', 'G', 'D'].map((n, i) => chord(4 + i, 5 + i, n))
    const text = chartFromAnalysis(song({ chords: [chord(0, 4, 'A'), ...chords], lines: [line(0, 'aa bb'), line(12, 'cc dd')] }))
    // the line goes on with the last chord written, so it is not written again
    expect(text).toContain('[A]aa bb\n[D] [G] [A] [Bm]\n[G] [D]\ncc dd')
  })

  it('writes a chord held across lines once, but again at the start of the next section', () => {
    const text = chartFromAnalysis(
      song({
        sections: [
          { t: 0, end: 10, label: 'Verse' },
          { t: 10, end: 20, label: 'Chorus' },
        ],
        chords: [chord(0, 6, 'D'), chord(6, 20, 'G')],
        lines: [line(0, 'aa bb'), line(3, 'cc dd'), line(6, 'ee ff'), line(8, 'gg hh'), line(10, 'ii jj')],
      }),
    )
    expect(text).toContain('[D]aa bb\ncc dd\n[G]ee ff\ngg hh\n{end_of_verse}')
    expect(text).toContain('{cue: 0:10.0}\n[G]ii jj')
  })

  it('leaves out quick chords unless asked, joining the chords around them', () => {
    // 120 bpm: a beat is 0.5 s, so the 0.5 s G is quick and the 1 s Bm is not
    const a = song({
      chords: [chord(0, 2, 'D'), chord(2, 2.5, 'G'), chord(2.5, 4, 'D'), chord(4, 5, 'Bm'), chord(5, 8, 'A')],
      lines: [line(0, 'aa bb cc dd ee ff')],
    })
    expect(chartFromAnalysis(a)).toContain('[D]aa bb cc dd [Bm]ee [A]ff')
    expect(chartFromAnalysis(a, { quickChords: true })).toContain('[D]aa bb [G]c[D]c dd [Bm]ee [A]ff')
  })

  it('places a change inside a held word where it falls', () => {
    const lines: Line[] = [{ t: 0, end: 4, words: [{ w: 'Ohhhhhhh', t: 0, end: 4 }] }]
    const text = chartFromAnalysis(song({ chords: [chord(0, 2, 'D'), chord(2, 4, 'G')], lines }))
    expect(text).toContain('[D]Ohhh[G]hhhh')
  })

  it('splits long lines at their longest pause', () => {
    const words = 'a b c d e f g h i j k l'.split(' ').map((w, i) => ({ w, t: i + (i >= 7 ? 2 : 0), end: i + (i >= 7 ? 2 : 0) + 0.5 }))
    const text = chartFromAnalysis(song({ lines: [{ t: 0, end: 14, words }] }), { maxWords: 10 })
    expect(text).toContain('a b c d e f g\nh i j k l')
  })

  it('keeps repeats in the order of the recording and makes the lines safe for ChordPro', () => {
    const text = chartFromAnalysis(
      song({
        sections: [
          { t: 0, end: 5, label: 'Chorus' },
          { t: 5, end: 10, label: 'Chorus' },
        ],
        lines: [line(0, 'x [y]'), line(5, 'x {y}')],
      }),
      { title: 'A {title}\nB' },
    )
    expect(text.match(/\{start_of_chorus: Chorus\}/g)).toHaveLength(2)
    expect(text).toContain('{title: A  title  B}')
    expect(parseChart(text).sections.map((s) => s.lines.length)).toEqual([1, 1])
    expect(text).not.toMatch(/\[y\]|\{y\}/)
  })

  it('gives a song without sections one, and leaves out what is missing', () => {
    const text = chartFromAnalysis(song({ key: '', lines: [line(3, 'aa')] }))
    expect(text).toBe('{start_of_verse: Song}\n{cue: 0:00.0}\naa\n{end_of_verse}\n')
  })
})

describe('respellChord', () => {
  it('writes the same chord with flats or sharps', () => {
    expect(respellChord('G#m7/D#', true)).toBe('Abm7/Eb')
    expect(respellChord('Bb', false)).toBe('A#')
    expect(respellChord('E/B', true)).toBe('E/B')
    expect(respellChord('N.C.', true)).toBe('N.C.')
  })
})
