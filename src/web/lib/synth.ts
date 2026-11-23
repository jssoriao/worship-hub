/**
 * A small Web Audio keyboard sound (no samples): each note is two oscillators through a filter and a gain that
 * strikes and fades like a struck string, so it sounds like an electric piano. Used by the MIDI file player and by a
 * MIDI keyboard played live; both share one AudioContext and one volume.
 */
export interface Voice {
  /** let the key go: the sound fades out from `at` (audio-clock seconds; now when left out) */
  release: (at?: number) => void
  /** audio-clock time it has finished by */
  ends: number
}
/** a held note fades out after this long even if the key stays down, as a real piano's would */
const MAX_RING = 8
const RELEASE = 0.12
export class Synth {
  private ctx: AudioContext | null = null
  private out: GainNode | null = null
  private volume = 0.8
  private voices = new Set<Voice>()
  /** the audio clock (starting the sound on first use; call from a click so the browser allows sound) */
  get audio(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' })
      const comp = this.ctx.createDynamicsCompressor()
      comp.threshold.value = -18
      comp.ratio.value = 4
      this.out = this.ctx.createGain()
      this.out.gain.value = this.volume * 0.6
      this.out.connect(comp).connect(this.ctx.destination)
    }
    return this.ctx
  }
  /** 0..1 */
  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v))
    if (this.out) this.out.gain.setTargetAtTime(this.volume * 0.6, this.audio.currentTime, 0.02)
  }
  async resume() {
    await this.audio.resume()
  }
  /** Starts a note at `start` (audio-clock seconds, now when earlier); it sounds until released (or MAX_RING). */
  strike(pitch: number, velocity: number, start = 0): Voice {
    const ctx = this.audio
    const t0 = Math.max(ctx.currentTime, start)
    const freq = 440 * 2 ** ((pitch - 69) / 12)
    const loud = (Math.max(1, velocity) / 127) ** 1.5 * 0.35
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, t0)
    gain.gain.linearRampToValueAtTime(loud, t0 + 0.005)
    // a struck string: falls quickly at first, then slowly while held (higher notes die away sooner)
    const decay = Math.max(0.6, 3.5 - (pitch - 40) * 0.035)
    gain.gain.setTargetAtTime(loud * 0.35, t0 + 0.005, decay / 4)
    gain.gain.setTargetAtTime(0, t0 + MAX_RING, RELEASE)
    const tone = ctx.createBiquadFilter()
    tone.type = 'lowpass'
    tone.frequency.value = Math.min(12000, freq * 6 + velocity * 30)
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
    a.start(t0)
    b.start(t0)
    const stopAt = (at: number) => {
      try {
        a.stop(at)
        b.stop(at)
      } catch {
        /* already stopped */
      }
    }
    stopAt(t0 + MAX_RING + RELEASE * 4)
    // when the key is let go; a later call may move it earlier (pause cuts notes scheduled to end later)
    let releaseAt = Infinity
    const voice: Voice = {
      ends: t0 + MAX_RING + RELEASE * 4,
      release: (at) => {
        const now = ctx.currentTime
        if (at === undefined && t0 > now) {
          // not started yet: it never sounds
          gain.gain.cancelScheduledValues(0)
          gain.gain.value = 0
          stopAt(now)
          releaseAt = now
          voice.ends = now
          return
        }
        const when = Math.max(now, at ?? now, t0)
        if (when >= releaseAt) return
        releaseAt = when
        gain.gain.cancelScheduledValues(when)
        gain.gain.setTargetAtTime(0, when, RELEASE / 3)
        voice.ends = when + RELEASE * 2
        stopAt(voice.ends)
      },
    }
    this.voices.add(voice)
    a.onended = () => {
      a.disconnect()
      b.disconnect()
      gain.disconnect()
      this.voices.delete(voice)
    }
    return voice
  }
  /** Silences everything at once (stop, seek). */
  silence() {
    for (const v of this.voices) v.release()
  }
  async close() {
    this.voices.clear()
    await this.ctx?.close()
    this.ctx = null
    this.out = null
  }
}
