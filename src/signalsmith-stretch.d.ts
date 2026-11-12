/** The parts of the Signalsmith Stretch web build that we use (the package ships no types). */
declare module 'signalsmith-stretch' {
  export interface StretchSchedule {
    /** audio context time of the change */
    output?: number
    active?: boolean
    /** playback rate; ignored for live input */
    rate?: number
    /** pitch shift */
    semitones?: number
    tonalityHz?: number
    formantCompensation?: boolean
    formantBaseHz?: number
  }
  export interface StretchNode extends AudioNode {
    schedule(change: StretchSchedule): Promise<unknown>
    stop(when?: number): Promise<unknown>
    /** delay it adds to live input, in seconds */
    latency(): Promise<number>
    configure(options: { blockMs?: number; intervalMs?: number; splitComputation?: boolean }): Promise<unknown>
  }
  export default function SignalsmithStretch(ctx: BaseAudioContext, options?: AudioWorkletNodeOptions): Promise<StretchNode>
}
