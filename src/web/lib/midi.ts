/**
 * Reads a Standard MIDI File (format 0 or 1) into notes with times in seconds, following the file's tempo changes.
 * Small on purpose: only what the MIDI page plays and draws (notes, the sustain pedal, tempo, track names).
 * Format 2 (independent sequences) and SMPTE time division are refused.
 */
export interface MidiNote {
  /** MIDI note number, 21 (A0) .. 108 (C8) on a piano */
  pitch: number
  /** seconds from the start of the file */
  t: number
  end: number
  /** 1..127 */
  velocity: number
  /** 0..15; 9 is drums */
  channel: number
}
export interface MidiSong {
  /** every note, by start time */
  notes: MidiNote[]
  /** seconds, until the last note ends */
  duration: number
  /** the first tempo, in beats per minute (120 when the file says none) */
  bpm: number
  /** how many tempo changes the file has after the first one */
  tempoChanges: number
  /** names of the tracks that have notes */
  tracks: string[]
}
const DRUMS = 9
export class MidiError extends Error {}
export function parseMidi(data: ArrayBuffer | Uint8Array): MidiSong {
  const b = data instanceof Uint8Array ? data : new Uint8Array(data)
  const text = (at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n))
  const u32 = (at: number) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0
  const u16 = (at: number) => (b[at] << 8) | b[at + 1]
  if (b.length < 14 || text(0, 4) !== 'MThd') throw new MidiError('This is not a MIDI file.')
  const format = u16(8)
  const trackCount = u16(10)
  const division = u16(12)
  if (format > 1) throw new MidiError('This MIDI file has separate songs in it (format 2), which cannot be played here.')
  if (division & 0x8000) throw new MidiError('This MIDI file is timed in SMPTE frames, which cannot be played here.')
  const ppq = division || 480
  type Raw = { tick: number; order: number; kind: 'on' | 'off' | 'pedal' | 'tempo'; channel: number; a: number; b: number }
  const events: Raw[] = []
  const names: string[] = []
  let order = 0
  let at = 8 + u32(4)
  for (let track = 0; track < trackCount && at + 8 <= b.length; track++) {
    const length = u32(at + 4)
    const isTrack = text(at, 4) === 'MTrk'
    const start = at + 8
    const stop = Math.min(start + length, b.length)
    at = start + length
    if (!isTrack) continue
    let p = start
    let tick = 0
    let running = 0
    let name = ''
    let hasNotes = false
    const vlq = () => {
      let v = 0
      for (let i = 0; i < 4 && p < stop; i++) {
        const c = b[p++]
        v = (v << 7) | (c & 0x7f)
        if (c < 0x80) break
      }
      return v
    }
    while (p < stop) {
      tick += vlq()
      if (p >= stop) break
      let status = b[p]
      if (status === 0xff) {
        const type = b[p + 1]
        p += 2
        const n = vlq()
        if (type === 0x51 && n === 3) events.push({ tick, order: order++, kind: 'tempo', channel: 0, a: (b[p] << 16) | (b[p + 1] << 8) | b[p + 2], b: 0 })
        if (type === 0x03 && !name) name = text(p, n).trim()
        p += n
        if (type === 0x2f) break
        continue
      }
      if (status === 0xf0 || status === 0xf7) {
        p++
        p += vlq()
        continue
      }
      if (status & 0x80) {
        running = status
        p++
      } else status = running
      if (!status) break // data with no status before it: a broken track
      const kind = status >> 4
      const channel = status & 0x0f
      if (kind === 0xc || kind === 0xd) {
        p += 1
        continue
      }
      const d1 = b[p]
      const d2 = b[p + 1]
      p += 2
      if (kind === 0x9 && d2 > 0) {
        events.push({ tick, order: order++, kind: 'on', channel, a: d1, b: d2 })
        hasNotes = true
      } else if (kind === 0x8 || kind === 0x9) events.push({ tick, order: order++, kind: 'off', channel, a: d1, b: 0 })
      else if (kind === 0xb && d1 === 64) events.push({ tick, order: order++, kind: 'pedal', channel, a: d2 >= 64 ? 1 : 0, b: 0 })
    }
    if (hasNotes) names.push(name || `Track ${track + 1}`)
  }
  // tempo changes apply to every track (format 1 keeps them in the first): walk all events in tick order
  events.sort((x, y) => x.tick - y.tick || x.order - y.order)
  const tempos = events.filter((e) => e.kind === 'tempo')
  // the tempo the song starts in: a change at the very start counts as the starting tempo
  const startsWith = tempos[0]?.tick === 0 ? tempos[0].a || 500000 : 500000
  const tempoChanges = tempos.length - (tempos[0]?.tick === 0 ? 1 : 0)
  let tempo = 500000 // microseconds per beat: 120 bpm
  let lastTick = 0
  let seconds = 0
  const notes: MidiNote[] = []
  // per channel and pitch, the notes still sounding (a pitch can be struck again before it is released)
  const open = new Map<number, MidiNote[]>()
  const pedalDown = new Set<number>()
  // notes let go while the pedal was down: they ring until it comes up
  const held = new Map<number, MidiNote[]>()
  const key = (channel: number, pitch: number) => channel * 128 + pitch
  for (const e of events) {
    seconds += ((e.tick - lastTick) * tempo) / ppq / 1e6
    lastTick = e.tick
    if (e.kind === 'tempo') tempo = e.a || tempo
    else if (e.kind === 'on') {
      const k = key(e.channel, e.a)
      // striking a key that rings on the pedal ends that sound (as on a real piano)
      for (const n of held.get(k) ?? []) n.end = seconds
      held.delete(k)
      const note: MidiNote = { pitch: e.a, t: seconds, end: seconds, velocity: e.b, channel: e.channel }
      notes.push(note)
      open.set(k, [...(open.get(k) ?? []), note])
    } else if (e.kind === 'off') {
      const k = key(e.channel, e.a)
      const list = open.get(k)
      const note = list?.shift()
      if (!note) continue
      if (list!.length === 0) open.delete(k)
      note.end = seconds
      if (pedalDown.has(e.channel)) held.set(k, [...(held.get(k) ?? []), note])
    } else if (e.kind === 'pedal') {
      if (e.a) pedalDown.add(e.channel)
      else {
        pedalDown.delete(e.channel)
        for (const [k, list] of held) {
          if (Math.floor(k / 128) !== e.channel) continue
          for (const n of list) n.end = seconds
          held.delete(k)
        }
      }
    }
  }
  // anything never released ends with the file
  for (const list of [...open.values(), ...held.values()]) for (const n of list) if (n.end < seconds) n.end = seconds
  for (const n of notes) if (n.end <= n.t) n.end = n.t + 0.05
  notes.sort((x, y) => x.t - y.t || x.pitch - y.pitch)
  const duration = notes.reduce((m, n) => Math.max(m, n.end), 0)
  return { notes, duration, bpm: Math.round((60e6 / startsWith) * 10) / 10, tempoChanges, tracks: names }
}
/** The notes sounding at `t` (drums left out), lowest first. */
export function notesAt(notes: MidiNote[], t: number): MidiNote[] {
  return notes.filter((n) => n.channel !== DRUMS && n.t <= t && n.end > t).sort((x, y) => x.pitch - y.pitch)
}
export const isDrum = (n: MidiNote) => n.channel === DRUMS
