import { describe, expect, it } from 'vitest'
import { chordFromNotes, prefersFlatsFor } from './chord-detect'
import { MidiError, notesAt, parseMidi } from './midi'
// builds a MIDI file from tracks of [delta ticks, ...event bytes]
const vlq = (n: number) => {
  const out = [n & 0x7f]
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80)
  return out
}
const track = (events: [number, ...number[]][]) => {
  const body = events.flatMap(([d, ...bytes]) => [...vlq(d), ...bytes])
  body.push(0, 0xff, 0x2f, 0)
  const n = body.length
  return [0x4d, 0x54, 0x72, 0x6b, (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255, ...body]
}
const file = (format: number, ppq: number, tracks: number[][]) =>
  new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, format, 0, tracks.length, ppq >> 8, ppq & 255, ...tracks.flat()])
const tempo = (bpm: number) => {
  const us = Math.round(60e6 / bpm)
  return [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255]
}
describe('reading a MIDI file', () => {
  it('times notes in seconds from the tempo, with running status and note-on velocity 0 as a release', () => {
    // 120 bpm, 480 ticks a beat: a beat is 0.5 s
    const midi = file(0, 480, [
      track([
        [0, ...tempo(120)],
        [0, 0x90, 60, 100],
        [480, 60, 0], // running status: note on, velocity 0 = off
        [0, 64, 80],
        [960, 0x80, 64, 0],
      ]),
    ])
    const song = parseMidi(midi)
    expect(song.bpm).toBe(120)
    expect(song.tempoChanges).toBe(0)
    expect(song.notes.map((n) => [n.pitch, n.t, n.end, n.velocity])).toEqual([
      [60, 0, 0.5, 100],
      [64, 0.5, 1.5, 80],
    ])
    expect(song.duration).toBe(1.5)
  })
  it('follows tempo changes kept in the first track of a format 1 file', () => {
    const midi = file(1, 480, [
      track([
        [0, ...tempo(120)],
        [960, ...tempo(60)], // after two beats (1 s) a beat lasts 1 s
      ]),
      track([
        [0, 0x91, 67, 90],
        [1440, 0x81, 67, 0], // three beats: 1 s + 1 s
      ]),
    ])
    const song = parseMidi(midi)
    expect(song.tempoChanges).toBe(1)
    expect(song.notes).toEqual([{ pitch: 67, t: 0, end: 2, velocity: 90, channel: 1 }])
    expect(song.tracks).toEqual(['Track 2'])
  })
  it('lets notes ring while the sustain pedal is down, until it comes up', () => {
    const midi = file(0, 480, [
      track([
        [0, 0xb0, 64, 127],
        [0, 0x90, 60, 100],
        [240, 0x80, 60, 0], // let go at 0.25 s, the pedal holds it
        [720, 0xb0, 64, 0], // pedal up at 1 s
      ]),
    ])
    expect(parseMidi(midi).notes[0].end).toBe(1)
  })
  it('refuses what is not a MIDI file', () => {
    expect(() => parseMidi(new Uint8Array([1, 2, 3]))).toThrow(MidiError)
  })
  it('lists the notes sounding at a moment, lowest first, without drums', () => {
    const notes = [
      { pitch: 67, t: 0, end: 2, velocity: 90, channel: 0 },
      { pitch: 60, t: 0.5, end: 1, velocity: 90, channel: 0 },
      { pitch: 36, t: 0, end: 2, velocity: 90, channel: 9 },
    ]
    expect(notesAt(notes, 0.75).map((n) => n.pitch)).toEqual([60, 67])
    expect(notesAt(notes, 1.5).map((n) => n.pitch)).toEqual([67])
  })
})
describe('naming the chord the notes make', () => {
  it('names triads, sevenths and suspended chords from their notes in any octave', () => {
    expect(chordFromNotes([48, 64, 67, 72])).toBe('C')
    expect(chordFromNotes([57, 60, 64])).toBe('Am')
    expect(chordFromNotes([55, 59, 62, 65])).toBe('G7')
    expect(chordFromNotes([50, 55, 57])).toBe('Dsus4')
    expect(chordFromNotes([53, 57, 60, 64])).toBe('Fmaj7')
    // no third: root, fifth and seventh
    expect(chordFromNotes([43, 50, 54, 62, 67, 78])).toBe('Gmaj7')
  })
  it('writes a chord over another bass note as a slash chord, and prefers the chord built on the bass', () => {
    expect(chordFromNotes([52, 60, 67])).toBe('C/E')
    expect(chordFromNotes([45, 60, 64, 67])).toBe('Am7')
    expect(chordFromNotes([48, 57, 64, 67])).toBe('C6')
  })
  it('spells with flats when asked', () => {
    expect(chordFromNotes([58, 62, 65], true)).toBe('Bb')
    expect(chordFromNotes([58, 62, 65])).toBe('A#')
  })
  it('gives no chord for fewer than three notes or notes no chord explains', () => {
    expect(chordFromNotes([])).toBeNull()
    expect(chordFromNotes([60, 67])).toBeNull()
    expect(chordFromNotes([60, 61, 62])).toBeNull()
  })
  it('reads a piece in a flat key as wanting flats', () => {
    // F major scale notes, held equally
    const f = [65, 67, 69, 70, 72, 74, 76].map((pitch, k) => ({ pitch, t: k, end: k + 1 }))
    expect(prefersFlatsFor(f)).toBe(true)
    const g = [67, 69, 71, 72, 74, 76, 78].map((pitch, k) => ({ pitch, t: k, end: k + 1 }))
    expect(prefersFlatsFor(g)).toBe(false)
  })
})
