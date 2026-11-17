import { describe, expect, it } from 'vitest'
import type { SongAnalysis } from './analysis'
import { parseAnalysis } from './analysis'
import { toStored } from './analysis-edit'
import { buildRows } from './lyric-rows'

// made-up song: 4 beats a bar, 0.5 s a beat (2 s a bar); an intro of chords and then one sung line
const chord = (t: number, name: string) => ({ t, end: t + 1, basic: name, simple: name, complex: name, bass: '' })
const song = (barsPerLine?: 1 | 2 | 4): SongAnalysis => ({
  key: 'C major',
  bpm: 120,
  beats: Array.from({ length: 48 }, (_, i) => ({ t: i * 0.5, n: (i % 4) + 1 })),
  // bars 1, 3 and 5 each have C then G; bar 6 has F
  chords: [chord(0, 'C'), chord(1, 'G'), chord(4, 'C'), chord(5, 'G'), chord(8, 'C'), chord(9, 'G'), chord(10, 'F')],
  sections: [{ t: 0, end: 12, label: 'Intro' }],
  lines: [{ t: 14, end: 16, words: [{ w: 'la', t: 14, end: 15 }] }],
  ...(barsPerLine ? { barsPerLine } : {}),
})
const chordRows = (a: SongAnalysis) => buildRows(a, 'simple').flatMap((r) => (r.kind === 'chords' ? [r.chords.join(' ')] : []))

describe('rows of chords where nothing is sung', () => {
  it('put two bars on a row unless the song says otherwise', () => {
    expect(chordRows(song())).toEqual(['C G', 'C G', 'C G F'])
  })
  it('follow the song\'s bars per row', () => {
    expect(chordRows(song(1))).toEqual(['C G', 'C G', 'C G', 'F'])
    expect(chordRows(song(4))).toEqual(['C G C G', 'C G F'])
  })
  it('keep the setting when the song is saved and read back', () => {
    expect(parseAnalysis(JSON.parse(JSON.stringify(toStored(song(4))))).barsPerLine).toBe(4)
    expect(parseAnalysis(JSON.parse(JSON.stringify(toStored(song())))).barsPerLine).toBeUndefined()
    expect(parseAnalysis({ ...toStored(song()), barsPerLine: 3 }).barsPerLine).toBeUndefined()
  })
})
