/**
 * Changing the key of what is heard, without changing the tempo. The engine also uses it to undo the
 * pitch change of a faster or slower tempo (playbackRate), so the shift can be any number of semitones.
 *
 * Every stem plays into `stems`; the click plays into `click`. At the original key the stems go
 * straight to the speakers (no delay, no processing). In another key they go through one pitch
 * shifter (Signalsmith Stretch, an AudioWorklet) that is loaded the first time it is needed. One
 * shifter for the whole mix keeps it light on phones. The click is not shifted; it is delayed by
 * the shifter's latency so it stays on the beat.
 */
import type { StretchNode } from 'signalsmith-stretch'

export const MAX_KEY_SHIFT = 6
/** the largest shift the bus applies: the key plus what undoes a tempo change */
const MAX_SHIFT = 12

const FADE = 0.03 // seconds, to cross between the straight and the shifted path

export class KeyBus {
  /** where the stems play into */
  readonly stems: GainNode
  /** where the click plays into */
  readonly click: GainNode
  /** everything heard goes through this on its way out: the master volume */
  readonly master: GainNode
  private dry: GainNode
  private wet: GainNode
  private clickDelay: DelayNode
  private shifter: StretchNode | null = null
  private loading: Promise<StretchNode> | null = null
  private semitones = 0
  private token = 0
  /** called when the shifter cannot be loaded (the key then stays original) */
  onError?: (e: unknown) => void

  readonly ctx: AudioContext

  constructor(ctx: AudioContext) {
    this.ctx = ctx
    this.stems = ctx.createGain()
    this.click = ctx.createGain()
    this.dry = ctx.createGain()
    this.wet = ctx.createGain()
    this.wet.gain.value = 0
    this.clickDelay = ctx.createDelay(1)
    this.master = ctx.createGain()
    this.master.connect(ctx.destination)
    this.stems.connect(this.dry).connect(this.master)
    this.wet.connect(this.master)
    this.click.connect(this.clickDelay).connect(this.master)
  }

  private load(): Promise<StretchNode> {
    this.loading ??= import('signalsmith-stretch').then(async ({ default: create }) => {
      const node = await create(this.ctx, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] })
      // 'explicit' so mono stems are heard on both sides
      node.channelCount = 2
      node.channelCountMode = 'explicit'
      return node
    })
    this.loading.catch(() => (this.loading = null))
    return this.loading
  }

  /** Sets how many semitones up (+) or down (-) the stems sound (fractions too). 0 is the original pitch. */
  async setSemitones(n: number) {
    const key = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, n))
    const token = ++this.token
    this.semitones = key
    const now = this.ctx.currentTime
    if (Math.abs(key) < 0.005) {
      this.through(false, now)
      return
    }
    try {
      const shifter = await this.load()
      if (token !== this.token) return // asked for something else meanwhile
      if (!this.shifter) {
        this.shifter = shifter
        this.stems.connect(shifter)
        shifter.connect(this.wet)
      }
      const delay = await shifter.latency().catch(() => 0.15)
      if (token !== this.token) return
      await shifter.schedule({ active: true, semitones: key })
      this.clickDelay.delayTime.value = Math.min(0.9, Math.max(0, delay))
      this.through(true, this.ctx.currentTime)
    } catch (e) {
      if (token === this.token) this.through(false, this.ctx.currentTime)
      this.onError?.(e)
    }
  }

  get current() {
    return this.semitones
  }

  /** Crosses over to the shifted path (true) or the straight one (false). */
  private through(shifted: boolean, at: number) {
    this.dry.gain.setTargetAtTime(shifted ? 0 : 1, at, FADE / 3)
    this.wet.gain.setTargetAtTime(shifted ? 1 : 0, at, FADE / 3)
    if (!shifted) {
      this.clickDelay.delayTime.value = 0
      // at the original key the shifter rests; it is switched on again when needed
      const shifter = this.shifter
      const token = this.token
      if (shifter) setTimeout(() => token === this.token && void shifter.stop().catch(() => {}), FADE * 3000)
    }
  }
}
