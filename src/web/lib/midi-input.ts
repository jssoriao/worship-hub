/**
 * A MIDI keyboard played live, through the browser's Web MIDI (Chrome, Edge, Firefox; not Safari). It keeps which
 * keys sound (held, or ringing on the sustain pedal) and, when its sound is on, plays them through a Synth.
 * Other apps on the computer (e.g. a piano program) can listen to the same keyboard at the same time.
 */
import type { Synth, Voice } from './synth'
export type MidiEvent = { kind: 'on'; pitch: number; velocity: number } | { kind: 'off'; pitch: number } | { kind: 'pedal'; down: boolean } | { kind: 'other' }
/** One MIDI message from a keyboard (any channel). A note-on with velocity 0 is a release, as keyboards send it. */
export function readMessage(data: ArrayLike<number>): MidiEvent {
  const status = data[0] ?? 0
  const kind = status >> 4
  if (kind === 0x9 && (data[2] ?? 0) > 0) return { kind: 'on', pitch: data[1], velocity: data[2] }
  if (kind === 0x8 || kind === 0x9) return { kind: 'off', pitch: data[1] }
  if (kind === 0xb && data[1] === 64) return { kind: 'pedal', down: (data[2] ?? 0) >= 64 }
  return { kind: 'other' }
}
export interface InputDevice {
  id: string
  name: string
}
export type InputState = { status: 'unsupported' } | { status: 'off' } | { status: 'denied' } | { status: 'on'; devices: InputDevice[] }
export const midiSupported = () => typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function'
export class LiveKeyboard {
  private access: MIDIAccess | null = null
  /** '' = every connected keyboard */
  private only = ''
  private sound = true
  private down = new Map<number, { velocity: number; voice?: Voice }>()
  /** let go while the pedal was down: they ring until it comes up */
  private ringing = new Map<number, { velocity: number; voice?: Voice }>()
  private pedal = false
  private changed?: () => void
  private devicesChanged?: (devices: InputDevice[]) => void
  private readonly synth: Synth
  constructor(synth: Synth) {
    this.synth = synth
  }
  /** `onNotes` runs whenever the sounding keys change; `onDevices` when keyboards are plugged in or out */
  listen(onNotes: (() => void) | undefined, onDevices: ((devices: InputDevice[]) => void) | undefined) {
    this.changed = onNotes
    this.devicesChanged = onDevices
  }
  /** Asks the browser for the keyboards (it may ask the person first). */
  async connect(): Promise<InputState> {
    if (!midiSupported()) return { status: 'unsupported' }
    try {
      this.access ??= await navigator.requestMIDIAccess({ sysex: false })
    } catch {
      return { status: 'denied' }
    }
    this.access.onstatechange = () => {
      this.wire()
      this.devicesChanged?.(this.devices())
    }
    this.wire()
    return { status: 'on', devices: this.devices() }
  }
  devices(): InputDevice[] {
    if (!this.access) return []
    return [...this.access.inputs.values()].filter((i) => i.state === 'connected').map((i) => ({ id: i.id, name: i.name || 'MIDI keyboard' }))
  }
  /** listen to one keyboard (its id), or to all of them ('') */
  choose(id: string) {
    this.only = id
    this.allOff()
    this.wire()
  }
  /** play the keys through the page's sound (off when another app or the keyboard itself makes the sound) */
  setSound(on: boolean) {
    this.sound = on
    if (!on) for (const n of [...this.down.values(), ...this.ringing.values()]) n.voice?.release()
  }
  /** the keys sounding now, with how hard each was played */
  get notes(): Map<number, number> {
    const out = new Map<number, number>()
    for (const [p, n] of this.ringing) out.set(p, n.velocity)
    for (const [p, n] of this.down) out.set(p, n.velocity)
    return out
  }
  disconnect() {
    if (this.access) {
      this.access.onstatechange = null
      for (const input of this.access.inputs.values()) input.onmidimessage = null
    }
    this.allOff()
  }
  private wire() {
    if (!this.access) return
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = this.only === '' || input.id === this.only ? (e) => this.handle(e.data ?? new Uint8Array()) : null
    }
  }
  /** A key played on the page (mouse or finger): it always sounds, even with the page's sound off for a keyboard. */
  press(pitch: number, velocity = 90) {
    void this.synth.resume()
    this.handle([0x90, pitch, velocity], true)
  }
  releaseKey(pitch: number) {
    this.handle([0x80, pitch, 0])
  }
  private handle(data: ArrayLike<number>, sound = this.sound) {
    const e = readMessage(data)
    if (e.kind === 'on') {
      // a key struck again while it rings on the pedal starts afresh
      this.ringing.get(e.pitch)?.voice?.release()
      this.ringing.delete(e.pitch)
      this.down.get(e.pitch)?.voice?.release()
      this.down.set(e.pitch, { velocity: e.velocity, voice: sound ? this.synth.strike(e.pitch, e.velocity) : undefined })
    } else if (e.kind === 'off') {
      const n = this.down.get(e.pitch)
      if (!n) return
      this.down.delete(e.pitch)
      if (this.pedal) this.ringing.set(e.pitch, n)
      else n.voice?.release()
    } else if (e.kind === 'pedal') {
      this.pedal = e.down
      if (!e.down) {
        for (const n of this.ringing.values()) n.voice?.release()
        this.ringing.clear()
      }
    } else return
    this.changed?.()
  }
  private allOff() {
    for (const n of [...this.down.values(), ...this.ringing.values()]) n.voice?.release()
    this.down.clear()
    this.ringing.clear()
    this.pedal = false
    this.changed?.()
  }
}
