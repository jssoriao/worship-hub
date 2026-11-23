import { describe, expect, it } from 'vitest'
import { chordFromNotes, chordKeys, inversionsOf, prefersFlatsFor } from './chord-detect'
import { readMessage } from './midi-input'
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

describe('the keys for a chord name', () => {
  it('gives the chord in root position from middle C up', () => {
    expect(chordKeys('C')).toEqual({ keys: [60, 64, 67], bass: null, chord: [60, 64, 67] })
    expect(chordKeys('Am7')?.keys).toEqual([69, 72, 76, 79])
  })
  it('turns the chord to an inversion, starting from its 2nd, 3rd or 4th note', () => {
    // E G C, G C E, B C E G
    expect(chordKeys('C', 1)?.keys).toEqual([64, 67, 72])
    expect(chordKeys('C', 2)?.keys).toEqual([67, 72, 76])
    expect(chordKeys('Cmaj7', 3)?.keys).toEqual([71, 72, 76, 79])
    // past the last inversion: the last one
    expect(chordKeys('C', 5)?.keys).toEqual([67, 72, 76])
  })
  it('puts the note after a slash in the left hand, under the chord in the chosen inversion', () => {
    // E3 under C4 E4 G4; E3 under E4 G4 C5; D3 under C E G
    expect(chordKeys('C/E')).toEqual({ keys: [52, 60, 64, 67], bass: 52, chord: [60, 64, 67] })
    expect(chordKeys('C/E', 1)?.keys).toEqual([52, 64, 67, 72])
    expect(chordKeys('C/D')?.keys).toEqual([50, 60, 64, 67])
    expect(chordKeys('D/F#')?.bass).toBe(54)
  })
  it('counts the inversions a chord has', () => {
    expect(inversionsOf('C')).toBe(2)
    expect(inversionsOf('G7')).toBe(3)
    expect(inversionsOf('nonsense')).toBe(0)
  })
  it('knows flats, sus and add9, and nothing it cannot name', () => {
    expect(chordKeys('Bb')?.keys).toEqual([70, 74, 77])
    expect(chordKeys('Csus4')?.keys).toEqual([60, 65, 67])
    expect(chordKeys('Cadd9')?.keys).toEqual([60, 62, 64, 67])
    expect(chordKeys('H7')).toBeNull()
    expect(chordKeys('Cxyz')).toBeNull()
  })
})
describe('messages from a MIDI keyboard', () => {
  it('reads key presses and releases on any channel, velocity 0 as a release, and the sustain pedal', () => {
    expect(readMessage([0x90, 60, 100])).toEqual({ kind: 'on', pitch: 60, velocity: 100 })
    expect(readMessage([0x93, 64, 1])).toEqual({ kind: 'on', pitch: 64, velocity: 1 })
    expect(readMessage([0x90, 60, 0])).toEqual({ kind: 'off', pitch: 60 })
    expect(readMessage([0x80, 60, 64])).toEqual({ kind: 'off', pitch: 60 })
    expect(readMessage([0xb0, 64, 127])).toEqual({ kind: 'pedal', down: true })
    expect(readMessage([0xb0, 64, 0])).toEqual({ kind: 'pedal', down: false })
    expect(readMessage([0xb0, 7, 100])).toEqual({ kind: 'other' })
    expect(readMessage([0xf8])).toEqual({ kind: 'other' })
  })
})
describe('a MIDI keyboard played live', () => {
  it('keeps the keys held and the ones ringing on the pedal, from the chosen keyboard only', async () => {
    const { LiveKeyboard } = await import('./midi-input')
    type Port = { id: string; name: string; state: string; onmidimessage: ((e: { data: Uint8Array }) => void) | null }
    const fp10: Port = { id: 'a', name: 'Piano A', state: 'connected', onmidimessage: null }
    const keylab: Port = { id: 'b', name: 'Synth B', state: 'connected', onmidimessage: null }
    const access = { inputs: new Map([['a', fp10], ['b', keylab]]), onstatechange: null }
    const nav = globalThis.navigator as unknown as { requestMIDIAccess?: unknown }
    const before = nav.requestMIDIAccess
    Object.defineProperty(globalThis.navigator, 'requestMIDIAccess', { value: async () => access, configurable: true })
    try {
      const kb = new LiveKeyboard({} as never)
      kb.setSound(false)
      const state = await kb.connect()
      expect(state).toEqual({ status: 'on', devices: [{ id: 'a', name: 'Piano A' }, { id: 'b', name: 'Synth B' }] })
      const send = (port: Port, ...bytes: number[]) => port.onmidimessage?.({ data: new Uint8Array(bytes) })
      send(fp10, 0x90, 60, 90)
      send(keylab, 0x90, 64, 70)
      expect([...kb.notes]).toEqual([[60, 90], [64, 70]])
      send(fp10, 0xb0, 64, 127)
      send(fp10, 0x80, 60, 0)
      expect(kb.notes.has(60)).toBe(true) // rings on the pedal
      send(fp10, 0xb0, 64, 0)
      expect(kb.notes.has(60)).toBe(false)
      kb.choose('a')
      expect(keylab.onmidimessage).toBeNull()
      send(fp10, 0x90, 67, 80)
      expect([...kb.notes.keys()]).toEqual([67])
      kb.disconnect()
      expect(fp10.onmidimessage).toBeNull()
    } finally {
      Object.defineProperty(globalThis.navigator, 'requestMIDIAccess', { value: before, configurable: true })
    }
  })
})
