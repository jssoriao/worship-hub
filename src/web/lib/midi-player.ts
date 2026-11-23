/**
 * Plays a MidiSong with a small Web Audio synth (no samples): each note is two oscillators through a gain that
 * strikes and fades like a struck string, so it sounds like an electric piano. Notes are scheduled a little ahead
 * on the audio clock, so timing does not depend on the page's frame rate. `rate` slows it down or speeds it up
 * (0.5 = half speed); the pitch stays the same, as MIDI notes are played, not stretched.
 */
import { isDrum, type MidiNote, type MidiSong } from './midi'
/** how far ahead notes are put on the audio clock, and how often that runs */
const AHEAD = 0.25
const TICK_MS = 50
/** a note sounds this long at most (a held key on a real piano fades out too) */
const MAX_RING = 6
const RELEASE = 0.12
export class MidiPlayer {
  private ctx: AudioContext | null = null
  private out: GainNode | null = null
  private song: MidiSong | null = null
  private playing = false
  /** song seconds at `startedAt` on the audio clock */
  private from = 0
  private startedAt = 0
  private pausedAt = 0
  private rate = 1
  private next = 0
  private timer: ReturnType<typeof setInterval> | undefined
  private voices = new Set<{ stop: (at: number) => void; ends: number }>()
  private ended?: () => void
  /** `fn` runs when the song reaches its end */
  whenEnded(fn: (() => void) | undefined) {
    this.ended = fn
  }
  load(song: MidiSong) {
    this.stopAll()
    this.song = song
    this.pausedAt = 0
  }
  get duration() {
    return this.song?.duration ?? 0
  }
  get isPlaying() {
    return this.playing
  }
  get tempo() {
    return this.rate
  }
  /** where the song is now, in seconds */
  get position(): number {
    if (!this.playing || !this.ctx) return this.pausedAt
    return Math.min(this.duration, this.from + (this.ctx.currentTime - this.startedAt) * this.rate)
  }
  async play() {
    if (!this.song || this.playing) return
    if (this.pausedAt >= this.duration) this.pausedAt = 0
    const ctx = this.audio()
    await ctx.resume()
    this.from = this.pausedAt
    this.startedAt = ctx.currentTime + 0.05
    // the first note at or after the playhead (notes already under way are not restarted)
    this.next = this.song.notes.findIndex((n) => n.t >= this.from)
    if (this.next < 0) this.next = this.song.notes.length
    this.playing = true
    this.pump()
    this.timer = setInterval(() => this.pump(), TICK_MS)
  }
  pause() {
    if (!this.playing) return
    this.pausedAt = this.position
    this.stopAll()
  }
  async seek(seconds: number) {
    const wasPlaying = this.playing
    this.pause()
    this.pausedAt = Math.min(Math.max(seconds, 0), this.duration)
    if (wasPlaying) await this.play()
  }
  /** 0.5 .. 1.5; a change while playing carries on from the same place */
  async setTempo(rate: number) {
    const wasPlaying = this.playing
    this.pause()
    this.rate = Math.min(1.5, Math.max(0.25, rate))
    if (wasPlaying) await this.play()
  }
  async dispose() {
    this.stopAll()
    this.song = null
    await this.ctx?.close()
    this.ctx = null
  }
  private audio(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      const comp = this.ctx.createDynamicsCompressor()
      comp.threshold.value = -18
      comp.ratio.value = 4
      this.out = this.ctx.createGain()
      this.out.gain.value = 0.5
      this.out.connect(comp).connect(this.ctx.destination)
    }
    return this.ctx
  }
  /** audio-clock time of a song time */
  private when(t: number) {
    return this.startedAt + (t - this.from) / this.rate
  }
  private pump() {
    const song = this.song
    const ctx = this.ctx
    if (!this.playing || !song || !ctx) return
    if (this.position >= song.duration) {
      this.pausedAt = song.duration
      this.stopAll()
      this.ended?.()
      return
    }
    const until = this.from + (ctx.currentTime + AHEAD - this.startedAt) * this.rate
    while (this.next < song.notes.length && song.notes[this.next].t < until) {
      const n = song.notes[this.next++]
      if (!isDrum(n)) this.voice(n)
    }
    // forget voices that have finished
    for (const v of this.voices) if (v.ends < ctx.currentTime) this.voices.delete(v)
  }
  private voice(n: MidiNote) {
    const ctx = this.ctx!
    const start = Math.max(ctx.currentTime, this.when(n.t))
    const hold = Math.min(MAX_RING, (n.end - n.t) / this.rate)
    const end = start + Math.max(0.05, hold)
    const freq = 440 * 2 ** ((n.pitch - 69) / 12)
    const loud = (n.velocity / 127) ** 1.5 * 0.35
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(loud, start + 0.005)
    // a struck string: falls quickly at first, then slowly while held (higher notes die away sooner)
    const decay = Math.max(0.6, 3.5 - (n.pitch - 40) * 0.035)
    gain.gain.setTargetAtTime(loud * 0.35, start + 0.005, decay / 4)
    gain.gain.setTargetAtTime(0, end, RELEASE / 3)
    const tone = ctx.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = Math.min(12000, freq * 6 + n.velocity * 30)
    const a = ctx.createOscillator()
    a.type = 'triangle'
    a.frequency.value = freq
    const b = ctx.createOscillator()
    b.type = 'sine'
    b.frequency.value = freq * 2
    const bGain = ctx.createGain()
    bGain.gain.value = 0.25
    a.connect(tone)
    b.connect(bGain).connect(tone)
    tone.connect(gain).connect(this.out!)
    const stopAt = end + RELEASE * 2
    a.start(start)
    b.start(start)
    a.stop(stopAt)
    b.stop(stopAt)
    const v = {
      ends: stopAt,
      stop: (at: number) => {
        gain.gain.cancelScheduledValues(at)
        gain.gain.setTargetAtTime(0, at, 0.01)
        try {
          a.stop(at + 0.05)
          b.stop(at + 0.05)
        } catch {
          /* already stopped */
        }
      },
    }
    this.voices.add(v)
    a.onended = () => {
      a.disconnect()
      b.disconnect()
      gain.disconnect()
      this.voices.delete(v)
    }
  }
  private stopAll() {
    clearInterval(this.timer)
    this.timer = undefined
    this.playing = false
    const now = this.ctx?.currentTime ?? 0
    for (const v of this.voices) v.stop(now)
    this.voices.clear()
  }
}
