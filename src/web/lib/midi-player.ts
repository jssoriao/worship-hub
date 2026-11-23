/**
 * Plays a MidiSong through a Synth. Notes are scheduled a little ahead on the audio clock, so timing does not depend
 * on the page's frame rate. `rate` slows it down or speeds it up (0.5 = half speed); the pitch stays the same, as
 * MIDI notes are played, not stretched.
 */
import { isDrum, type MidiSong } from './midi'
import type { Synth, Voice } from './synth'
/** how far ahead notes are put on the audio clock, and how often that runs */
const AHEAD = 0.25
const TICK_MS = 50
export class MidiPlayer {
  private song: MidiSong | null = null
  private playing = false
  /** song seconds at `startedAt` on the audio clock */
  private from = 0
  private startedAt = 0
  private pausedAt = 0
  private rate = 1
  private next = 0
  private timer: ReturnType<typeof setInterval> | undefined
  private voices = new Set<Voice>()
  private ended?: () => void
  private readonly synth: Synth
  constructor(synth: Synth) {
    this.synth = synth
  }
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
  /** where the song is now, in seconds */
  get position(): number {
    if (!this.playing) return this.pausedAt
    return Math.min(this.duration, this.from + (this.synth.audio.currentTime - this.startedAt) * this.rate)
  }
  async play() {
    if (!this.song || this.playing) return
    if (this.pausedAt >= this.duration) this.pausedAt = 0
    await this.synth.resume()
    this.from = this.pausedAt
    this.startedAt = this.synth.audio.currentTime + 0.05
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
  dispose() {
    this.stopAll()
    this.song = null
  }
  /** audio-clock time of a song time */
  private when(t: number) {
    return this.startedAt + (t - this.from) / this.rate
  }
  private pump() {
    const song = this.song
    if (!this.playing || !song) return
    const now = this.synth.audio.currentTime
    if (this.position >= song.duration) {
      this.pausedAt = song.duration
      this.stopAll()
      this.ended?.()
      return
    }
    const until = this.from + (now + AHEAD - this.startedAt) * this.rate
    while (this.next < song.notes.length && song.notes[this.next].t < until) {
      const n = song.notes[this.next++]
      if (isDrum(n)) continue
      const v = this.synth.strike(n.pitch, n.velocity, this.when(n.t))
      v.release(this.when(Math.max(n.end, n.t + 0.05)))
      this.voices.add(v)
    }
    for (const v of this.voices) if (v.ends < now) this.voices.delete(v)
  }
  private stopAll() {
    clearInterval(this.timer)
    this.timer = undefined
    this.playing = false
    for (const v of this.voices) v.release()
    this.voices.clear()
  }
}
