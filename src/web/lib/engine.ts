import { openStem } from './audio-cache'
import { HttpError, type ByteStream } from './bytestream'
import { Mp3Feed, createDecoder, peaksOfBytes, sniffSampleRate, streamingMp3Decoder, type StemDecoder } from './decoders'
import { KeyBus } from './key-shift'
import { computeMix, lazyFlags, type MixState, type StemLayout } from './mix'
import type { StemSource } from './sources'

export interface StemInfo {
  id: string
  name: string
  group: string
  /** the combined stem of its group (see mix.ts) */
  mix: boolean
  /** empty until known (a waveform in the manifest makes it known before the audio arrives) */
  peaks: number[]
  /** the audio has started arriving and can be played; parts of a combined stem start unloaded */
  loaded: boolean
  loading: boolean
}

/** How much of the downloads has arrived. `active` is how many files are still coming. */
export interface DownloadProgress {
  active: number
  fraction: number
}

/** Thrown when a load is replaced by a newer one. */
export class SupersededError extends Error {}

const CHUNK_SEC = 8 // decoded PCM chunk size
const AHEAD_SEC = 20 // how far ahead to decode + schedule
const PUMP_MS = 250
const STALL_MARGIN_SEC = 1 // pause for buffering when downloaded audio runs this close to the playhead
const RESUME_AHEAD_SEC = 6 // and carry on once this much is downloaded ahead of it
const BUFFERING_SHOWN_AFTER_MS = 150
const CLICK_AHEAD_SEC = 1.5 // clicks are scheduled this far ahead (the pump runs every PUMP_MS)

/**
 * A piece of the recording in a timeline (an arrangement): from `src` to `end` (seconds in the
 * recording), with a gain per stem (by index; missing = 1, 0 = muted in this piece).
 */
export interface TimelineSegment {
  src: number
  end: number
  gains?: number[]
}

/** One chunk of one segment, as scheduled: where it plays and which part of the chunk. */
interface Unit {
  seg: number
  k: number
  /** start in timeline seconds */
  at: number
  /** seconds into the chunk */
  offset: number
  dur: number
  fadeIn: boolean
  fadeOut: boolean
}

const FADE_SEC = 0.01 // at joins between pieces that do not follow on in the recording

/** A beat of the click track: its time in the song, and whether it starts a bar. */
export interface ClickBeat {
  t: number
  accent: boolean
}

interface Track {
  source: StemSource
  info: StemInfo
  /** set once the first bytes have arrived and the file has been read as audio */
  decoder?: StemDecoder
  /** the download, for files that stream */
  feed?: Mp3Feed
  /**
   * Playing in sync: the decoder exists and, if playback is running, the chunks that were already
   * queued for the other stems are queued for this one too. The mix only counts a stem as loaded
   * once it is ready, so gains never switch to a stem that cannot be heard yet.
   */
  ready: boolean
  pending?: Promise<boolean>
  gain: GainNode
  cache: Map<number, Promise<AudioBuffer | null>>
}

/** A file whose beginning has arrived: either streaming, or a whole Blob (zips, WAV). */
type Opened = { kind: 'feed'; feed: Mp3Feed; sampleRate: number } | { kind: 'blob'; blob: Blob; sampleRate: number | null }

function describe(error: unknown): string {
  if (error instanceof HttpError && error.status === 401) return 'you are signed out; reload and sign in again'
  // fetch() fails with a TypeError when there is no connection at all
  if (error instanceof TypeError || (typeof navigator !== 'undefined' && !navigator.onLine)) {
    return 'there is no connection, and this song is not saved on this device'
  }
  return error instanceof Error ? error.message : 'unsupported or corrupt audio'
}

/**
 * Plays many stems in sync while only keeping ~AHEAD_SEC of decoded audio
 * per stem in memory. Chunks are scheduled on the AudioContext clock at exact
 * sample boundaries, so stems stay sample-aligned and chunk joins are seamless.
 *
 * Stems stream: playback starts once the first seconds of every audible stem have arrived, the
 * rest keeps downloading behind the playhead, and if it ever falls behind the playhead pauses
 * ("buffering") and carries on by itself.
 */
export class StemEngine {
  private _ctx: AudioContext
  private tracks: Track[] = []
  private layout: StemLayout[] = []
  private lastMix: MixState[] = []
  private audible: boolean[] = []
  private sources = new Set<AudioBufferSourceNode>()
  private playing = false
  /** the person wants it playing: true while it plays, waits to start, or waits for a download */
  private intent = false
  private stalled = false
  private stallToken = 0
  private buffering = false
  private startedAt = 0 // ctx time corresponding to position 0
  private pausedAt = 0
  private gen = 0 // bumps on every stop/seek to cancel stale async work
  private loadGen = 0
  private nextChunk = 0
  private timer: ReturnType<typeof setInterval> | undefined
  private abort = new AbortController()
  private progressTimer: ReturnType<typeof setInterval> | undefined
  private lastProgress = ''
  // the click: a short tone on every beat, scheduled on the same clock as the stems
  private beats: ClickBeat[] = []
  private nextBeat = 0
  private clickOn = false
  private clickVolume = 0.8
  private clickGain: GainNode | null = null
  /** where stems and click play into (and the key they sound in), made again for a new context */
  private bus: KeyBus | null = null
  private semitones = 0
  /** master volume, 0..1 */
  private volume = 1
  private clickSounds: { ctx: AudioContext; accent: AudioBuffer; beat: AudioBuffer } | null = null
  /** the clicks as heard: the song's beats, or mapped through the timeline (plus a count-in) */
  private clicks: ClickBeat[] = []
  // timeline mode (arrangements): null plays the recording straight through
  private segments: TimelineSegment[] | null = null
  private lead = 0
  private leadBeats: ClickBeat[] = []
  private units: Unit[] = []
  private segAt: number[] = []
  private timelineLength = 0
  private nextUnit = 0
  onEnded?: () => void
  onError?: (e: unknown) => void
  /** The key could not be changed (the pitch shifter did not load); the stems play in their own key. */
  onKeyError?: (e: unknown) => void
  /** A stem started or finished downloading (parts of combined stems load on demand). */
  onStemsChange?: (stems: StemInfo[]) => void
  /** Playback is waiting for audio to download (true) or carries on (false). */
  onBuffering?: (buffering: boolean) => void
  onDownload?: (progress: DownloadProgress) => void

  constructor() {
    this._ctx = StemEngine.createContext()
  }

  get ctx() {
    return this._ctx
  }

  /** The stems' and click's output for the current context, in the chosen key. */
  private get keyBus(): KeyBus {
    if (this.bus?.ctx !== this._ctx) {
      this.bus = new KeyBus(this._ctx)
      this.bus.onError = (e) => {
        this.semitones = 0 // it plays in the original key then
        this.onKeyError?.(e)
      }
      if (this.semitones !== 0) void this.bus.setSemitones(this.semitones)
      this.bus.master.gain.value = this.volume
    }
    return this.bus
  }

  /** Plays the stems this many semitones up (+) or down (-), at the same tempo. 0 is the original key. */
  setKey(semitones: number) {
    this.semitones = semitones
    void this.keyBus.setSemitones(semitones)
  }

  /** The master volume (0..1): stems and click together. */
  setVolume(volume: number) {
    this.volume = Math.min(1, Math.max(0, volume))
    this.keyBus.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.01)
  }
  private static createContext(sampleRate?: number): AudioContext {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (sampleRate) {
      try {
        return new Ctor({ sampleRate })
      } catch {
        /* rate not supported: fall back to the device rate */
      }
    }
    return new Ctor()
  }

  /**
   * Run the graph at the stems' native rate so chunk decodes need no
   * resampling (bit-exact joins). The browser converts to the device rate once.
   */
  private async matchSampleRate(rate: number | null) {
    if (!rate || rate === this._ctx.sampleRate) return
    const old = this._ctx
    this._ctx = StemEngine.createContext(rate)
    await old.close().catch(() => {})
  }

  private get chunkLen() {
    return Math.round(CHUNK_SEC * this.ctx.sampleRate)
  }
  private get chunkSec() {
    return this.chunkLen / this.ctx.sampleRate
  }

  /** Length of what plays: the timeline in timeline mode, otherwise the recording. */
  get duration() {
    return this.segments ? this.timelineLength : this.recordingDuration
  }

  /** Length of the recording (the longest stem). */
  get recordingDuration() {
    return this.tracks.reduce((m, t) => Math.max(m, t.decoder?.length ?? 0), 0) / this.ctx.sampleRate
  }

  /** Playing, or about to: waiting for audio to download so it can start or carry on. */
  get isPlaying() {
    return this.intent
  }

  get position() {
    const p = this.playing ? this.ctx.currentTime - this.startedAt : this.pausedAt
    return Math.min(Math.max(p, 0), this.duration)
  }

  private setBuffering(value: boolean) {
    if (value === this.buffering) return
    this.buffering = value
    this.onBuffering?.(value)
  }

  // ---------------------------------------------------------------- loading

  /**
   * Starts a file's download (or takes it from the device) and waits for its first bytes. Zip
   * entries and WAV files come as a Blob; MP3 from the library streams.
   */
  private async openData(s: StemSource): Promise<Opened> {
    if (s.url && s.ext === 'mp3') {
      const stream = openStem({ url: s.url, version: s.version, group: s.cacheGroup, signal: this.abort.signal })
      const feed = new Mp3Feed(stream)
      const isMp3 = await feed.ready()
      // The header says how long the file is, so playback can start before the rest arrives.
      if (isMp3 && feed.ix.declaredFrames !== undefined) return { kind: 'feed', feed, sampleRate: feed.ix.sampleRate }
      await stream.complete()
      if (isMp3 && feed.ix.count >= 2) return { kind: 'feed', feed, sampleRate: feed.ix.sampleRate }
      return { kind: 'blob', blob: new Blob([stream.bytes().slice()]), sampleRate: null }
    }
    const blob = await s.getBlob()
    const head = new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer())
    return { kind: 'blob', blob, sampleRate: sniffSampleRate(head, s.ext) }
  }

  /** The decoder for an opened file, plus the waveform when it has to be decoded for. */
  private async decoderFor(s: StemSource, o: Opened): Promise<{ decoder: StemDecoder; peaks: number[]; feed?: Mp3Feed }> {
    if (o.kind === 'feed') return { decoder: streamingMp3Decoder(this.ctx, o.feed), peaks: [], feed: o.feed }
    // a waveform from the manifest saves decoding the whole file just to draw it
    const created = await createDecoder(this.ctx, o.blob, s.ext, !s.peaks)
    return { decoder: created.decoder, peaks: created.peaks }
  }

  /** Without a waveform in the manifest, draw it from the audio once it has all arrived. */
  private peaksWhenComplete(t: Track, myLoad: number) {
    if (t.source.peaks || !t.feed) return
    const stream = t.feed.stream
    void stream
      .complete()
      .then(() => peaksOfBytes(stream.bytes()))
      .then((peaks) => {
        if (myLoad !== this.loadGen) return
        t.info.peaks = peaks
        this.onStemsChange?.(this.infos())
      })
      .catch(() => {})
  }

  async load(
    sources: StemSource[],
    onProgress?: (done: number, total: number, name: string) => void,
  ): Promise<StemInfo[]> {
    this.unload()
    const myLoad = ++this.loadGen
    const abort = (this.abort = new AbortController())
    const layout = sources.map((s) => ({ group: s.group, mix: s.mix === true }))
    // parts of a combined stem are fetched after the song is playable (see preloadParts)
    const lazy = lazyFlags(layout)
    const eager = sources.map((_, i) => i).filter((i) => !lazy[i])
    const opened = new Map<number, Opened>()
    let done = 0
    try {
      // all main stems at once: only their first bytes are needed before the song is playable
      await Promise.all(
        eager.map(async (i) => {
          const s = sources[i]
          let o: Opened
          try {
            o = await this.openData(s)
          } catch (e) {
            if (myLoad !== this.loadGen) throw new SupersededError()
            throw new Error(`Could not read "${s.name}": ${describe(e)}`)
          }
          if (myLoad !== this.loadGen) throw new SupersededError()
          opened.set(i, o)
          onProgress?.(++done, eager.length, s.name)
        }),
      )
      if (myLoad !== this.loadGen) throw new SupersededError()
      await this.matchSampleRate(eager.length ? (opened.get(eager[0])?.sampleRate ?? null) : null)
    } catch (e) {
      abort.abort() // do not keep downloading a song that will not play
      throw e
    }
    const made = new Map<number, Awaited<ReturnType<StemEngine['decoderFor']>>>()
    for (const i of eager) {
      try {
        made.set(i, await this.decoderFor(sources[i], opened.get(i)!))
      } catch (e) {
        abort.abort()
        if (myLoad !== this.loadGen) throw new SupersededError()
        throw new Error(`Could not read "${sources[i].name}": ${describe(e)}`)
      }
      if (myLoad !== this.loadGen) throw new SupersededError()
    }
    // gain nodes are created last: the context may have been replaced while matching the sample rate
    this.layout = layout
    this.tracks = sources.map((s, i) => {
      const gain = this.ctx.createGain()
      gain.connect(this.keyBus.stems)
      const d = made.get(i)
      return {
        source: s,
        // known waveform first: parts that are not downloaded yet can still be drawn
        info: { id: s.id, name: s.name, group: s.group, mix: s.mix === true, peaks: s.peaks ?? d?.peaks ?? [], loaded: !!d, loading: false },
        decoder: d?.decoder,
        feed: d?.feed,
        ready: !!d,
        gain,
        cache: new Map(),
      }
    })
    this.tracks.forEach((t) => this.peaksWhenComplete(t, myLoad))
    this.applyMix(sources.map(() => ({ muted: false, solo: false, volume: 1 })))
    this.progressTimer = setInterval(() => this.reportDownload(), 500)
    // the song is playable now; fetch the parts behind it (after load() has handed its result back)
    setTimeout(() => void this.preloadParts(myLoad), 0)
    return this.infos()
  }

  unload() {
    this.halt()
    this.intent = false
    this.stalled = false
    this.stallToken++
    this.setBuffering(false)
    this.loadGen++
    this.abort.abort() // stop every download of the song being left
    clearInterval(this.progressTimer)
    this.progressTimer = undefined
    this.lastProgress = ''
    this.tracks.forEach((t) => t.gain.disconnect())
    this.tracks = []
    this.layout = []
    this.lastMix = []
    this.audible = []
    this.pausedAt = 0
    this.beats = []
    this.clicks = []
    this.nextBeat = 0
    this.segments = null
    this.units = []
    this.timelineLength = 0
  }

  private infos(): StemInfo[] {
    return this.tracks.map((t) => ({ ...t.info }))
  }

  private streams(): ByteStream[] {
    return this.tracks.flatMap((t) => (t.feed ? [t.feed.stream] : []))
  }

  /** Bytes received over bytes expected, across the files that have started downloading. */
  private reportDownload() {
    const streams = this.streams()
    const active = streams.filter((s) => !s.done && !s.error).length
    let have = 0
    let want = 0
    for (const s of streams) {
      have += s.length
      want += s.total ?? s.length
    }
    const fraction = want > 0 ? have / want : 1
    const key = `${active}:${Math.round(fraction * 100)}`
    if (key === this.lastProgress) return
    this.lastProgress = key
    this.onDownload?.({ active, fraction })
  }

  applyMix(mix: MixState[]) {
    this.lastMix = mix
    const { gains, need, warm } = computeMix(this.layout, mix, this.tracks.map((t) => t.ready))
    this.audible = gains.map((g) => g > 0)
    gains.forEach((g, i) => this.tracks[i]?.gain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.01))
    for (const i of need) void this.ensureLoaded(i)
    // Fetch the rest of an edited group only once nothing is waiting on a download, so it never
    // slows down the parts that are needed right now.
    if (need.length === 0) for (const i of warm) void this.ensureLoaded(i, true)
  }

  /**
   * Starts a stem that was left out of the first load, then lets it join playback in sync.
   * `quiet` is for background downloads: a failure is not reported (it is retried, loudly, if the
   * stem is needed later). Resolves to whether the stem is now ready.
   */
  private ensureLoaded(i: number, quiet = false): Promise<boolean> {
    const t = this.tracks[i]
    if (!t) return Promise.resolve(false)
    if (t.ready) return Promise.resolve(true)
    if (t.pending) return t.pending
    const myLoad = this.loadGen
    t.info.loading = true
    this.onStemsChange?.(this.infos())
    t.pending = (async () => {
      let ok = false
      try {
        const o = await this.openData(t.source)
        if (myLoad !== this.loadGen) return false
        const made = await this.decoderFor(t.source, o)
        if (myLoad !== this.loadGen) return false
        t.decoder = made.decoder
        t.feed = made.feed
        t.info.peaks = t.source.peaks ?? made.peaks
        t.info.loaded = true
        this.peaksWhenComplete(t, myLoad)
        await this.joinPlayback(t)
        ok = true
      } catch (e) {
        if (myLoad === this.loadGen && !quiet) {
          this.onError?.(new Error(`Could not load "${t.source.name}": ${describe(e)}`))
        }
      } finally {
        t.pending = undefined
        if (myLoad === this.loadGen) {
          t.info.loading = false
          this.onStemsChange?.(this.infos())
        }
      }
      // the stem can be heard now: switch the gains over
      if (ok && myLoad === this.loadGen) this.applyMix(this.lastMix)
      return ok && myLoad === this.loadGen
    })()
    return t.pending
  }

  /**
   * Once the song is playable, fetches the parts of combined stems in the background, one at a
   * time and in display order, so switching to them later is instant. The main stems finish
   * downloading first, so parts never slow down what is playing. Anything the person is waiting
   * on goes first; this only continues when nothing is. Skipped when the browser asks to save
   * data. A failed download stops it quietly.
   */
  private async preloadParts(myLoad: number) {
    if ((navigator as { connection?: { saveData?: boolean } }).connection?.saveData) return
    const lazy = lazyFlags(this.layout)
    await Promise.allSettled(this.tracks.filter((_, i) => !lazy[i]).map((t) => t.feed?.stream.complete()))
    while (myLoad === this.loadGen) {
      const { need } = computeMix(this.layout, this.lastMix, this.tracks.map((t) => t.ready))
      if (need.length > 0) {
        const waiting = need.map((i) => this.tracks[i]?.pending).filter((p) => p !== undefined)
        if (waiting.length === 0) return // a download someone needs failed: leave it to them
        await Promise.allSettled(waiting)
        continue
      }
      const next = this.tracks.findIndex((t, i) => lazy[i] && !t.ready && !t.pending)
      if (next < 0) return // everything is loaded, or being loaded by someone else
      if (!(await this.ensureLoaded(next, true))) return
    }
  }

  /**
   * Downloads every stem completely (so the song is saved on the device). Resolves when all have
   * arrived; throws if one fails.
   */
  async loadAll(): Promise<void> {
    const myLoad = this.loadGen
    for (let i = 0; i < this.tracks.length; i++) {
      if (myLoad !== this.loadGen) return
      if (!this.tracks[i].ready && !(await this.ensureLoaded(i))) throw new Error(`Could not load "${this.tracks[i]?.source.name ?? 'a stem'}".`)
    }
    await Promise.all(this.streams().map((s) => s.complete()))
  }

  /**
   * Makes a freshly started stem play in sync with the others. It waits until audio from the
   * playhead has arrived, then (while playing) queues for it the chunks already queued for the
   * other stems; the pump takes over for the rest. The gains only switch afterwards, so there is
   * no gap when swapping sources.
   */
  private async joinPlayback(t: Track) {
    const decoder = t.decoder
    if (!decoder) return
    const sr = this.ctx.sampleRate
    if (!this.playing) {
      // a stem is only "ready" with audio at the playhead, or switching to it would be silence
      const at = this.segments ? this.srcOf(this.position) : this.position
      await decoder.whenBuffered(Math.min(decoder.length, Math.floor(at * sr) + this.chunkLen))
      t.ready = true
      return
    }
    if (this.segments) return this.joinTimeline(t)
    const gen = this.gen
    let k: number
    do {
      k = Math.floor(this.position / this.chunkSec)
      await this.chunk(t, k)
    } while (gen === this.gen && this.playing && k !== Math.floor(this.position / this.chunkSec))
    // stopped or seeked meanwhile: play() starts every ready stem from the new position
    t.ready = true
    if (gen !== this.gen || !this.playing) return
    // from here on the pump includes this stem; no await between the flag and the loop
    for (let c = Math.floor(this.position / this.chunkSec); c < this.nextChunk; c++) {
      this.chunk(t, c).then(
        (buf) => {
          if (buf && gen === this.gen) this.schedule(t, buf, c)
        },
        (e) => {
          t.cache.delete(c)
          if (gen === this.gen) this.onError?.(e)
        },
      )
    }
  }

  // ---------------------------------------------------------------- playback

  async play() {
    if (this.playing || this.tracks.length === 0) return
    this.intent = true
    this.stalled = false
    this.stallToken++
    const resumed = this.ctx.resume() // call inside the tap for iOS
    const gen = ++this.gen
    const offset = this.pausedAt >= this.duration ? 0 : this.pausedAt
    const k0 = Math.floor(offset / this.chunkSec)
    // in timeline mode, the chunks of the first two pieces to play from here
    const u0 = this.segments ? this.unitAt(offset) : 0
    const firstChunks = this.segments ? this.units.slice(u0, u0 + 2).map((u) => u.k) : [k0, k0 + 1]
    // The first two chunks of every stem that is heard must be here before starting. Silent stems
    // never hold playback up; they start decoding now and join when their audio arrives.
    const heard = this.tracks.filter((t, i) => t.ready && this.audible[i])
    this.tracks.forEach((t) => {
      if (t.ready && !heard.includes(t) && firstChunks.length) void this.chunk(t, firstChunks[0]).catch(() => {})
    })
    const waiting = setTimeout(() => {
      if (gen === this.gen) this.setBuffering(true)
    }, BUFFERING_SHOWN_AFTER_MS)
    try {
      await Promise.all([resumed, ...heard.flatMap((t) => firstChunks.map((k) => this.chunk(t, k)))])
    } catch (e) {
      if (gen === this.gen) {
        this.setBuffering(false)
        this.onError?.(e)
      }
      return
    } finally {
      clearTimeout(waiting)
    }
    if (gen !== this.gen) return
    this.setBuffering(false)
    const sr = this.ctx.sampleRate
    // snap to a sample frame so every chunk boundary lands on an exact frame
    this.startedAt = Math.round((this.ctx.currentTime + 0.08 - offset) * sr) / sr
    this.playing = true
    this.nextChunk = k0
    this.nextUnit = u0
    this.nextBeat = this.beatAt(offset)
    this.pump(gen)
    this.timer = setInterval(() => this.pump(gen), PUMP_MS)
  }

  pause() {
    this.intent = false
    if (this.stalled) {
      this.stalled = false
      this.stallToken++
      this.setBuffering(false)
      return
    }
    if (!this.playing) {
      this.gen++ // a play() still waiting for audio is cancelled
      this.setBuffering(false)
      return
    }
    this.pausedAt = this.position
    this.halt()
  }

  /** Stops and goes back to the start. */
  stop() {
    this.pause()
    this.gen++ // nothing still starting may play from where it was
    this.pausedAt = 0
  }
  async seek(seconds: number) {
    const wasPlaying = this.intent
    const t = Math.min(Math.max(seconds, 0), this.duration)
    this.stalled = false
    this.stallToken++
    if (this.playing) this.halt()
    else this.gen++ // a play() still waiting for audio would start from the old position
    this.pausedAt = t
    if (wasPlaying) await this.play()
  }

  async dispose() {
    this.unload()
    await this._ctx.close()
  }

  private halt() {
    this.gen++
    clearInterval(this.timer)
    this.timer = undefined
    for (const s of this.sources) {
      s.onended = null
      try {
        s.stop()
      } catch {
        /* not started / already stopped */
      }
      s.disconnect()
    }
    this.sources.clear()
    this.playing = false
  }

  /** True when a stem that is heard has not downloaded as far as just ahead of the playhead. */
  private isStarved(positionSec: number): boolean {
    const sr = this.ctx.sampleRate
    // how far into the recording the next moments reach (a timeline may jump ahead)
    const need = this.segments ? this.furthestSrc(positionSec, positionSec + STALL_MARGIN_SEC) : positionSec + STALL_MARGIN_SEC
    return this.tracks.some((t, i) => {
      const d = t.decoder
      if (!t.ready || !d || !this.audible[i]) return false
      return d.bufferedLength < Math.min(Math.floor(need * sr), d.length)
    })
  }

  /** The download fell behind the playhead: pause here, and carry on when enough has arrived. */
  private stall() {
    this.pausedAt = this.position
    this.halt()
    this.stalled = true
    this.setBuffering(true)
    void this.resumeWhenBuffered(++this.stallToken)
  }

  private async resumeWhenBuffered(token: number) {
    const sr = this.ctx.sampleRate
    const target = Math.floor(
      (this.segments ? this.furthestSrc(this.pausedAt, this.pausedAt + RESUME_AHEAD_SEC) : this.pausedAt + RESUME_AHEAD_SEC) * sr,
    )
    try {
      await Promise.all(
        this.tracks.flatMap((t, i) => (t.ready && t.decoder && this.audible[i] ? [t.decoder.whenBuffered(Math.min(target, t.decoder.length))] : [])),
      )
    } catch (e) {
      if (token === this.stallToken && this.stalled) {
        this.stalled = false
        this.setBuffering(false)
        this.onError?.(e)
      }
      return
    }
    if (token !== this.stallToken || !this.stalled) return
    this.stalled = false
    await this.play()
  }

  private pump(gen: number) {
    if (gen !== this.gen || !this.playing) return
    const pos = this.position
    if (pos >= this.duration) {
      this.halt()
      this.intent = false
      this.pausedAt = 0
      this.onEnded?.()
      return
    }
    if (this.isStarved(pos)) {
      this.stall()
      return
    }
    this.scheduleClicks(pos)
    if (this.segments) {
      this.pumpTimeline(gen, pos)
      return
    }
    const horizon = Math.min(pos + AHEAD_SEC, this.duration)
    while (this.nextChunk * this.chunkSec < horizon) {
      const k = this.nextChunk++
      for (const t of this.tracks) {
        if (!t.ready) continue
        this.chunk(t, k).then(
          (buf) => {
            if (buf && gen === this.gen) this.schedule(t, buf, k)
          },
          (e) => {
            t.cache.delete(k)
            if (gen === this.gen) this.onError?.(e)
          },
        )
      }
    }
    this.evict(Math.floor(pos / this.chunkSec))
  }

  // ---------------------------------------------------------------- click

  /** The beats of the song (from its analysis), or [] for none. */
  setBeats(beats: ClickBeat[]) {
    this.beats = beats
    this.mapClicks()
  }

  /** The clicks to play: the beats as they are, or placed through the timeline after its count-in. */
  private mapClicks() {
    if (!this.segments) {
      this.clicks = this.beats
    } else {
      const out: ClickBeat[] = [...this.leadBeats]
      this.segments.forEach((seg, i) => {
        for (const b of this.beats) if (b.t >= seg.src && b.t < seg.end) out.push({ t: this.segAt[i] + (b.t - seg.src), accent: b.accent })
      })
      this.clicks = out.sort((a, b) => a.t - b.t)
    }
    this.nextBeat = this.beatAt(this.position)
  }

  /** Turns the click on or off and sets its volume (0..1). Takes effect from the next beat. */
  setClick(on: boolean, volume: number) {
    this.clickOn = on
    this.clickVolume = volume
    if (this.clickGain) this.clickGain.gain.setTargetAtTime(on ? volume : 0, this.ctx.currentTime, 0.01)
  }

  /** Index of the first beat at or after `t`. */
  private beatAt(t: number): number {
    let lo = 0
    let hi = this.clicks.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.clicks[mid].t < t) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  /** The click's output and sounds, made again when the context was replaced (sample rate). */
  private clickOut() {
    const ctx = this.ctx
    if (!this.clickGain || this.clickGain.context !== ctx) {
      this.clickGain = ctx.createGain()
      this.clickGain.gain.value = this.clickOn ? this.clickVolume : 0
      this.clickGain.connect(this.keyBus.click)
    }
    if (this.clickSounds?.ctx !== ctx) {
      // short sine blips with a fast decay: higher for the first beat of a bar
      const tone = (hz: number) => {
        const len = Math.round(ctx.sampleRate * 0.05)
        const buf = ctx.createBuffer(1, len, ctx.sampleRate)
        const data = buf.getChannelData(0)
        for (let i = 0; i < len; i++) {
          const t = i / ctx.sampleRate
          data[i] = Math.sin(2 * Math.PI * hz * t) * Math.exp(-t * 90) * 0.9
        }
        return buf
      }
      this.clickSounds = { ctx, accent: tone(1760), beat: tone(1175) }
    }
    return { gain: this.clickGain, sounds: this.clickSounds }
  }

  /** Queues the clicks of the next CLICK_AHEAD_SEC. Beats that are already past are skipped. */
  private scheduleClicks(pos: number) {
    if (this.clicks.length === 0) return
    const until = Math.min(pos + CLICK_AHEAD_SEC, this.duration)
    const now = this.ctx.currentTime + 0.005
    const out = this.clickOn ? this.clickOut() : null
    while (this.nextBeat < this.clicks.length && this.clicks[this.nextBeat].t < until) {
      const beat = this.clicks[this.nextBeat++]
      const when = this.startedAt + beat.t
      // off: the beat is passed over, so turning the click on carries on from where the song is
      if (!out || when < now) continue
      const src = this.ctx.createBufferSource()
      src.buffer = beat.accent ? out.sounds.accent : out.sounds.beat
      src.connect(out.gain)
      src.start(when)
      src.onended = () => {
        src.disconnect()
        this.sources.delete(src)
      }
      this.sources.add(src)
    }
  }

  // ---------------------------------------------------------------- timeline (arrangements)

  /**
   * Plays pieces of the recording in this order instead of straight through (null: straight
   * through again). `lead` seconds of count-in come first, with `leadBeats` as its clicks. Call
   * after load(). If it is playing, it carries on from the same moment of the new timeline.
   */
  setTimeline(segments: TimelineSegment[] | null, lead = 0, leadBeats: ClickBeat[] = []) {
    const wasPlaying = this.playing
    const at = this.position
    if (this.playing) this.halt()
    this.segments = segments && segments.length > 0 ? segments.map((s) => ({ ...s })) : null
    this.lead = this.segments ? Math.max(0, lead) : 0
    this.leadBeats = this.segments ? leadBeats : []
    this.buildUnits()
    this.mapClicks()
    this.pausedAt = Math.min(at, this.duration)
    if (wasPlaying) void this.play()
  }

  /** Splits each segment into the chunks it covers; also where each segment starts on the timeline. */
  private buildUnits() {
    this.units = []
    this.segAt = []
    this.timelineLength = 0
    const segs = this.segments
    if (!segs) return
    const sr = this.ctx.sampleRate
    const cs = this.chunkSec
    const total = this.recordingDuration
    const snap = (x: number) => Math.round(Math.min(Math.max(x, 0), total) * sr) / sr
    let at = Math.round(this.lead * sr) / sr
    segs.forEach((seg, i) => {
      const s0 = snap(seg.src)
      const s1 = snap(seg.end)
      seg.src = s0
      seg.end = s1
      this.segAt.push(at)
      if (s1 <= s0) return
      const prev = segs[i - 1]
      const next = segs[i + 1]
      const same = (a?: number[], b?: number[]) => this.tracks.every((_, j) => (a?.[j] ?? 1) === (b?.[j] ?? 1))
      // no fade where the recording simply carries on with the same mutes
      const fadeIn = !(prev ? prev.end === s0 && same(prev.gains, seg.gains) : s0 === 0)
      const fadeOut = !(next ? snap(next.src) === s1 && same(seg.gains, next.gains) : s1 >= total)
      for (let k = Math.floor(s0 / cs); k * cs < s1; k++) {
        const a = Math.max(s0, k * cs)
        const b = Math.min(s1, (k + 1) * cs)
        if (b <= a) continue
        this.units.push({ seg: i, k, at: at + (a - s0), offset: a - k * cs, dur: b - a, fadeIn: fadeIn && a === s0, fadeOut: fadeOut && b === s1 })
      }
      at += s1 - s0
    })
    this.timelineLength = at
  }

  /** Index of the unit playing at timeline time `t` (or the next one). */
  private unitAt(t: number): number {
    const i = this.units.findIndex((u) => u.at + u.dur > t)
    return i < 0 ? this.units.length : i
  }

  /** Where in the recording timeline time `t` is. */
  private srcOf(t: number): number {
    const segs = this.segments
    if (!segs || segs.length === 0) return t
    if (t <= this.segAt[0]) return segs[0].src
    for (let i = 0; i < segs.length; i++) {
      const len = segs[i].end - segs[i].src
      if (t < this.segAt[i] + len) return segs[i].src + (t - this.segAt[i])
    }
    return segs[segs.length - 1].end
  }

  /** How far into the recording timeline times t0..t1 reach (the most that must be downloaded). */
  private furthestSrc(t0: number, t1: number): number {
    const segs = this.segments ?? []
    let far = this.srcOf(t0)
    segs.forEach((seg, i) => {
      const a = this.segAt[i]
      const b = a + (seg.end - seg.src)
      if (b <= t0 || a >= t1) return
      far = Math.max(far, seg.src + (Math.min(b, t1) - a))
    })
    return far
  }

  private pumpTimeline(gen: number, pos: number) {
    const horizon = Math.min(pos + AHEAD_SEC, this.duration)
    while (this.nextUnit < this.units.length && this.units[this.nextUnit].at < horizon) {
      const u = this.units[this.nextUnit++]
      this.tracks.forEach((t, i) => {
        if (t.ready) this.queueUnit(gen, t, i, u)
      })
    }
    // keep the chunks of what plays from a second ago to a little past the horizon
    const keep = new Set(this.units.filter((u) => u.at + u.dur >= pos - 1 && u.at < horizon + this.chunkSec).map((u) => u.k))
    for (const t of this.tracks) for (const k of t.cache.keys()) if (!keep.has(k)) t.cache.delete(k)
  }

  private queueUnit(gen: number, t: Track, i: number, u: Unit) {
    if ((this.segments?.[u.seg]?.gains?.[i] ?? 1) <= 0) return // muted in this piece
    this.chunk(t, u.k).then(
      (buf) => {
        if (buf && gen === this.gen) this.scheduleUnit(t, i, buf, u)
      },
      (e) => {
        t.cache.delete(u.k)
        if (gen === this.gen) this.onError?.(e)
      },
    )
  }

  private scheduleUnit(t: Track, i: number, buf: AudioBuffer, u: Unit) {
    const level = this.segments?.[u.seg]?.gains?.[i] ?? 1
    let when = this.startedAt + u.at
    let offset = u.offset
    let dur = Math.min(u.dur, buf.duration - u.offset)
    let fadeIn = u.fadeIn
    const now = this.ctx.currentTime + 0.005
    if (when < now) {
      // late (or the first piece after a seek): start partway in, faded in so it does not click
      offset += now - when
      dur -= now - when
      when = now
      fadeIn = true
    }
    if (dur <= 0.002) return
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    const g = this.ctx.createGain()
    g.gain.setValueAtTime(fadeIn ? 0 : level, when)
    if (fadeIn) g.gain.linearRampToValueAtTime(level, when + Math.min(FADE_SEC, dur / 2))
    if (u.fadeOut) {
      g.gain.setValueAtTime(level, when + Math.max(0, dur - FADE_SEC))
      g.gain.linearRampToValueAtTime(0, when + dur)
    }
    src.connect(g).connect(t.gain)
    src.start(when, offset, dur)
    src.onended = () => {
      src.disconnect()
      g.disconnect()
      this.sources.delete(src)
    }
    this.sources.add(src)
  }

  /** A stem that arrives while a timeline plays: queue what the others have queued, from the playhead. */
  private async joinTimeline(t: Track) {
    const gen = this.gen
    const i = this.tracks.indexOf(t)
    let u: number
    do {
      u = this.unitAt(this.position)
      if (u >= this.units.length) break
      await this.chunk(t, this.units[u].k)
    } while (gen === this.gen && this.playing && u !== this.unitAt(this.position))
    t.ready = true
    if (gen !== this.gen || !this.playing) return
    for (let v = this.unitAt(this.position); v < this.nextUnit; v++) this.queueUnit(gen, t, i, this.units[v])
  }

  private schedule(t: Track, buf: AudioBuffer, k: number) {
    let when = this.startedAt + k * this.chunkSec
    let offset = 0
    const now = this.ctx.currentTime + 0.005
    if (when < now) {
      // late (or first chunk after a seek): start mid-chunk to stay in sync
      offset = now - when
      when = now
      if (offset >= buf.duration) return
    }
    const src = this.ctx.createBufferSource()
    src.buffer = buf
    src.connect(t.gain)
    src.start(when, offset)
    src.onended = () => {
      src.disconnect()
      this.sources.delete(src)
    }
    this.sources.add(src)
  }

  private evict(current: number) {
    const keepTo = current + Math.ceil(AHEAD_SEC / this.chunkSec) + 1
    for (const t of this.tracks) {
      for (const k of t.cache.keys()) if (k < current || k > keepTo) t.cache.delete(k)
    }
  }

  /** Exact chunk k (chunkLen samples, last one shorter) for a track, cached. */
  private chunk(t: Track, k: number): Promise<AudioBuffer | null> {
    let p = t.cache.get(k)
    if (!p) {
      const made = this.buildChunk(t, k)
      p = made
      t.cache.set(k, made)
      // a failed decode (the download broke) must not be remembered, so a retry can try again
      made.catch(() => {
        if (t.cache.get(k) === made) t.cache.delete(k)
      })
    }
    return p
  }

  private async buildChunk(t: Track, k: number): Promise<AudioBuffer | null> {
    const decoder = t.decoder
    if (!decoder) return null
    const g0 = k * this.chunkLen
    const g1 = Math.min(g0 + this.chunkLen, decoder.length)
    if (g0 >= g1) return null
    const { buffer, base } = await decoder.decodeRange(g0, g1)
    const len = g1 - g0
    const out = this.ctx.createBuffer(buffer.numberOfChannels, len, this.ctx.sampleRate)
    const off = g0 - base
    const from = Math.max(0, off)
    const to = Math.min(buffer.length, off + len)
    if (to > from) {
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        out.getChannelData(c).set(buffer.getChannelData(c).subarray(from, to), from - off)
      }
    }
    return out
  }
}
