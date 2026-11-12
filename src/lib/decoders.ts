/**
 * Stem decoders that decode audio in small time ranges instead of all at once.
 * Only compressed bytes stay in memory; PCM is produced per chunk. MP3 is decoded while it is
 * still downloading: the index of frames grows with the bytes, and a decode waits only for the
 * bytes of its own range.
 *
 * All positions are in output samples at the AudioContext sample rate.
 */
import { ByteStream } from './bytestream.ts'

export interface DecodedSlice {
  buffer: AudioBuffer
  /** global output-sample index of buffer[0] */
  base: number
}

export interface StemDecoder {
  /** total length in output samples */
  readonly length: number
  /**
   * Output samples that can be decoded right now. Equals `length` once the whole file is here;
   * less while a streamed file is still arriving.
   */
  readonly bufferedLength: number
  /** Resolves when output sample `sample` can be decoded; throws if the download failed. */
  whenBuffered(sample: number): Promise<void>
  /** decode a slice covering [start, end) (may include extra margin); waits for the bytes it needs */
  decodeRange(start: number, end: number): Promise<DecodedSlice>
}

// dev/songs-plugin.ts (peaksFor) makes the same waveform for manifests; keep the two in step
const PEAK_BARS = 600

export function computePeaks(buffer: AudioBuffer, bars = PEAK_BARS): number[] {
  const channels: Float32Array[] = []
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c))
  const block = Math.max(1, Math.floor(buffer.length / bars))
  const peaks: number[] = new Array(bars).fill(0)
  for (let i = 0; i < bars; i++) {
    const start = i * block
    const end = Math.min(buffer.length, start + block)
    const stride = Math.max(1, Math.floor((end - start) / 200))
    let max = 0
    for (const data of channels) {
      for (let j = start; j < end; j += stride) {
        const v = Math.abs(data[j])
        if (v > max) max = v
      }
    }
    peaks[i] = max
  }
  return peaks
}

/** Waveform peaks from a low-sample-rate decode to keep memory small. */
async function peaksFromBytes(bytes: ArrayBuffer): Promise<number[]> {
  for (const rate of [8000, 22050]) {
    try {
      const off = new OfflineAudioContext(1, 1, rate)
      const buf = await off.decodeAudioData(bytes.slice(0))
      return computePeaks(buf)
    } catch {
      /* try next rate */
    }
  }
  return new Array(PEAK_BARS).fill(0)
}

// ---------------------------------------------------------------- MP3

const BR_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0]
const BR_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0]
const SR: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }

interface FrameHeader {
  length: number
  sampleRate: number
  spf: number
  sideInfo: number
}

function readFrameHeader(b: Uint8Array, p: number): FrameHeader | null {
  if (p + 4 > b.length || b[p] !== 0xff || (b[p + 1] & 0xe0) !== 0xe0) return null
  const ver = (b[p + 1] >> 3) & 3
  const layer = (b[p + 1] >> 1) & 3
  if (ver === 1 || layer !== 1) return null // reserved version / not Layer III
  const brIdx = b[p + 2] >> 4
  const srIdx = (b[p + 2] >> 2) & 3
  if (brIdx === 0 || brIdx === 15 || srIdx === 3) return null
  const pad = (b[p + 2] >> 1) & 1
  const mono = b[p + 3] >> 6 === 3
  const bitrate = (ver === 3 ? BR_V1_L3 : BR_V2_L3)[brIdx] * 1000
  const sampleRate = SR[ver][srIdx]
  const spf = ver === 3 ? 1152 : 576
  const length = Math.floor(((spf / 8) * bitrate) / sampleRate) + pad
  const sideInfo = ver === 3 ? (mono ? 17 : 32) : mono ? 9 : 17
  return { length, sampleRate, spf, sideInfo }
}

interface Mp3Index {
  offsets: Uint32Array // frame start offsets + end sentinel
  spf: number
  sampleRate: number
  /** samples of priming silence at the start (encoder delay + decoder delay) */
  delay: number
  /** encoder padding at the end */
  padding: number
}

const DECODER_DELAY = 529 // standard MP3 decoder (MDCT/filterbank) delay

/** Encoder delay/padding from a LAME/Lavc tag inside the Xing/Info frame, if present. */
function lameGapless(b: Uint8Array, xingAt: number): { delay: number; padding: number } {
  const flags = (b[xingAt + 4] << 24) | (b[xingAt + 5] << 16) | (b[xingAt + 6] << 8) | b[xingAt + 7]
  let o = xingAt + 8
  if (flags & 1) o += 4
  if (flags & 2) o += 4
  if (flags & 4) o += 100
  if (flags & 8) o += 4
  const enc = String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])
  if (enc !== 'LAME' && enc !== 'Lavc' && enc !== 'Lavf') return { delay: 0, padding: 0 }
  return { delay: (b[o + 21] << 4) | (b[o + 22] >> 4), padding: ((b[o + 22] & 0x0f) << 8) | b[o + 23] }
}

/** Frames the Xing/Info tag says the file has (flag bit 0), if it says. The tag's own frame is not counted. */
function xingFrames(b: Uint8Array, xingAt: number): number | undefined {
  const flags = (b[xingAt + 4] << 24) | (b[xingAt + 5] << 16) | (b[xingAt + 6] << 8) | b[xingAt + 7]
  if (!(flags & 1)) return undefined
  const n = ((b[xingAt + 8] << 24) | (b[xingAt + 9] << 16) | (b[xingAt + 10] << 8) | b[xingAt + 11]) >>> 0
  return n > 0 ? n : undefined
}

/**
 * Finds the frames of an MP3 as its bytes arrive. Call `advance` with the growing file after every
 * append; it parses every frame that is complete and stops where the data ends. With the whole file
 * and `final` it gives the same frames as indexing the file in one go.
 */
export class Mp3Indexer {
  private p = 0
  private started = false
  private first: FrameHeader | null = null
  private starts = new Uint32Array(8192)
  private n = 0
  private end = 0
  private gapless = { delay: 0, padding: 0 }
  private declared: number | undefined
  private ready = false

  /** complete audio frames found so far */
  get count() {
    return this.n
  }
  /** the first frame and the Xing/Info tag in it have been read, so the rate and delay are known */
  get headerReady() {
    return this.ready
  }
  get sampleRate() {
    return this.first?.sampleRate ?? 0
  }
  get spf() {
    return this.first?.spf ?? 0
  }
  /** samples of priming silence (encoder delay + decoder delay) */
  get delay() {
    return this.gapless.delay + DECODER_DELAY
  }
  get padding() {
    return this.gapless.padding
  }
  /** audio frames the file declares up front; with this a file's length is known before it is all here */
  get declaredFrames() {
    return this.declared
  }

  /** Byte offset where frame `i` starts. For `i === count` it is where the last parsed frame ends. */
  startOf(i: number): number {
    return i < this.n ? this.starts[i] : this.end
  }

  /** `b` holds the file so far (only the first `avail` bytes count); `final` means no more will come. */
  advance(b: Uint8Array, avail: number, final: boolean): void {
    const v = b.subarray(0, avail)
    if (!this.started) {
      if (avail < 10 && !final) return
      this.started = true
      if (v[0] === 0x49 && v[1] === 0x44 && v[2] === 0x33) {
        const size = ((v[6] & 0x7f) << 21) | ((v[7] & 0x7f) << 14) | ((v[8] & 0x7f) << 7) | (v[9] & 0x7f)
        this.p = 10 + size + (v[5] & 0x10 ? 10 : 0)
      }
      this.end = this.p
    }
    while (this.p + 4 <= avail) {
      const p = this.p
      const h = readFrameHeader(v, p)
      let ok = false
      if (h && (!this.first || h.sampleRate === this.first.sampleRate)) {
        if (this.n > 0) {
          ok = true
        } else if (p + h.length >= avail) {
          // the frame reaches the end of the data: only fine if that is the end of the file
          if (!final) return
          ok = true
        } else {
          // before the first frame is trusted, the next frame must look valid too (resync check)
          if (!final && p + h.length + 4 > avail) return
          ok = readFrameHeader(v, p + h.length) !== null
        }
      }
      if (!h || !ok) {
        this.p++
        continue
      }
      if (!this.first) {
        this.first = h
        const t = p + 4 + h.sideInfo
        const tag = String.fromCharCode(v[t], v[t + 1], v[t + 2], v[t + 3])
        const vbri = String.fromCharCode(v[p + 36], v[p + 37], v[p + 38], v[p + 39])
        this.ready = true
        if (tag === 'Xing' || tag === 'Info' || vbri === 'VBRI') {
          this.gapless = lameGapless(v, t)
          if (tag === 'Xing' || tag === 'Info') this.declared = xingFrames(v, t)
          this.p += h.length // skip metadata frame
          continue
        }
      }
      if (p + h.length > avail) {
        if (final) break
        return // wait for the rest of this frame
      }
      if (this.n === this.starts.length) {
        const bigger = new Uint32Array(this.starts.length * 2)
        bigger.set(this.starts)
        this.starts = bigger
      }
      this.starts[this.n++] = p
      this.p += h.length
      this.end = this.p
    }
  }

  /** The finished index of a whole file, or null if it is not an MP3 we can slice. */
  snapshot(): Mp3Index | null {
    if (!this.first || this.n < 2) return null
    const offsets = new Uint32Array(this.n + 1)
    offsets.set(this.starts.subarray(0, this.n))
    offsets[this.n] = this.end
    return { offsets, spf: this.first.spf, sampleRate: this.first.sampleRate, delay: this.delay, padding: this.gapless.padding }
  }
}

/** Index of a complete MP3, or null. */
export function indexMp3(b: Uint8Array): Mp3Index | null {
  const ix = new Mp3Indexer()
  ix.advance(b, b.length, true)
  return ix.snapshot()
}

/** A downloading MP3 together with the index that is built from it. */
export class Mp3Feed {
  readonly stream: ByteStream
  readonly ix = new Mp3Indexer()

  constructor(stream: ByteStream) {
    this.stream = stream
    stream.onChange(() => this.update())
    this.update()
  }

  private update() {
    this.ix.advance(this.stream.bytes(), this.stream.length, this.stream.done)
  }

  /** Waits for the first frames: true if this is an MP3 we can stream, false if the file ended without being one. */
  async ready(): Promise<boolean> {
    for (;;) {
      if (this.ix.headerReady) return true
      if (this.stream.done) return false
      await this.stream.whenLength(this.stream.length + 1)
    }
  }
}

class Mp3Decoder implements StemDecoder {
  private readonly ctx: BaseAudioContext
  private readonly feed: Mp3Feed

  constructor(ctx: BaseAudioContext, feed: Mp3Feed) {
    this.ctx = ctx
    this.feed = feed
  }

  private get ix() {
    return this.feed.ix
  }
  /** frames in the whole file: declared up front, exact once it has all arrived */
  private get frames() {
    return this.feed.stream.done ? this.ix.count : Math.max(this.ix.declaredFrames ?? 0, this.ix.count)
  }
  private get ratio() {
    return this.ctx.sampleRate / this.ix.sampleRate
  }
  get length() {
    return Math.max(0, Math.floor((this.frames * this.ix.spf - this.ix.delay - this.ix.padding) * this.ratio))
  }
  get bufferedLength() {
    if (this.feed.stream.done) return this.length
    // a decode of the range ending at `s` needs frames up to ceil((s/r + delay) / spf) + 3
    const usable = this.ix.count - 3
    return Math.min(this.length, Math.max(0, Math.floor((usable * this.ix.spf - this.ix.delay) * this.ratio)))
  }

  async whenBuffered(sample: number): Promise<void> {
    const stream = this.feed.stream
    for (;;) {
      if (stream.error) throw stream.error
      if (stream.done || this.bufferedLength >= sample) return
      await stream.changed()
    }
  }

  async decodeRange(start: number, end: number): Promise<DecodedSlice> {
    await this.whenBuffered(end)
    const { spf, delay } = this.ix
    const r = this.ratio
    // timeline position 0 = first real sample, i.e. decoder sample `delay`
    // leading frames rebuild the bit reservoir / decoder state; trailing ones flush it
    const f0 = Math.max(0, Math.floor((start / r + delay) / spf) - 10)
    const f1 = Math.min(this.frames, this.ix.count, Math.ceil((end / r + delay) / spf) + 3)
    const data = this.feed.stream.bytes().slice(this.ix.startOf(f0), this.ix.startOf(f1)) // a copy: decodeAudioData takes it
    const buffer = await this.ctx.decodeAudioData(data.buffer)
    // anchor at the slice end: robust if a decoder drops/pads leading frames
    return { buffer, base: Math.round((f1 * spf - delay) * r - buffer.length) }
  }
}

// ---------------------------------------------------------------- WAV

interface WavInfo {
  code: number
  channels: number
  rate: number
  bits: number
  blockAlign: number
  dataOffset: number
  frames: number
}

export function parseWav(u8: Uint8Array): WavInfo | null {
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const tag = (o: number) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3])
  if (u8.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null
  let p = 12
  let fmt: Omit<WavInfo, 'dataOffset' | 'frames'> | null = null
  while (p + 8 <= u8.length) {
    const id = tag(p)
    const size = v.getUint32(p + 4, true)
    const body = p + 8
    if (id === 'fmt ') {
      let code = v.getUint16(body, true)
      if (code === 0xfffe && size >= 26) code = v.getUint16(body + 24, true)
      fmt = {
        code,
        channels: v.getUint16(body + 2, true),
        rate: v.getUint32(body + 4, true),
        blockAlign: v.getUint16(body + 12, true),
        bits: v.getUint16(body + 14, true),
      }
    } else if (id === 'data') {
      if (!fmt || (fmt.code !== 1 && fmt.code !== 3) || !fmt.blockAlign) return null
      const avail = u8.length - body
      const len = size === 0 || size > avail ? avail : size
      return { ...fmt, dataOffset: body, frames: Math.floor(len / fmt.blockAlign) }
    }
    p = body + size + (size & 1)
  }
  return null
}

function wavHeader(w: WavInfo, dataLen: number): Uint8Array {
  const v = new DataView(new ArrayBuffer(44))
  const s = (o: number, t: string) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  s(0, 'RIFF')
  v.setUint32(4, 36 + dataLen, true)
  s(8, 'WAVE')
  s(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, w.code, true)
  v.setUint16(22, w.channels, true)
  v.setUint32(24, w.rate, true)
  v.setUint32(28, w.rate * w.blockAlign, true)
  v.setUint16(32, w.blockAlign, true)
  v.setUint16(34, w.bits, true)
  s(36, 'data')
  v.setUint32(40, dataLen, true)
  return new Uint8Array(v.buffer)
}

class WavDecoder implements StemDecoder {
  private readonly ctx: BaseAudioContext
  private readonly blob: Blob
  private readonly w: WavInfo

  constructor(ctx: BaseAudioContext, blob: Blob, w: WavInfo) {
    this.ctx = ctx
    this.blob = blob
    this.w = w
  }

  private get ratio() {
    return this.ctx.sampleRate / this.w.rate
  }
  get length() {
    return Math.floor(this.w.frames * this.ratio)
  }
  get bufferedLength() {
    return this.length // the whole file is a Blob already
  }
  whenBuffered(): Promise<void> {
    return Promise.resolve()
  }

  async decodeRange(start: number, end: number): Promise<DecodedSlice> {
    const r = this.ratio
    const { blockAlign, dataOffset, frames } = this.w
    const s0 = Math.max(0, Math.floor(start / r) - 64) // margin for resampler edges
    const s1 = Math.min(frames, Math.ceil(end / r) + 64)
    const pcm = await this.blob.slice(dataOffset + s0 * blockAlign, dataOffset + s1 * blockAlign).arrayBuffer()
    const file = new Uint8Array(44 + pcm.byteLength)
    file.set(wavHeader(this.w, pcm.byteLength), 0)
    file.set(new Uint8Array(pcm), 44)
    const buffer = await this.ctx.decodeAudioData(file.buffer)
    return { buffer, base: Math.round(s0 * r) }
  }
}

// ---------------------------------------------------------------- fallback

/** For formats we can't slice (m4a, ogg, flac): decode fully once. */
class FullDecoder implements StemDecoder {
  private readonly buffer: AudioBuffer
  constructor(buffer: AudioBuffer) {
    this.buffer = buffer
  }
  get length() {
    return this.buffer.length
  }
  get bufferedLength() {
    return this.buffer.length
  }
  whenBuffered(): Promise<void> {
    return Promise.resolve()
  }
  async decodeRange(): Promise<DecodedSlice> {
    return { buffer: this.buffer, base: 0 }
  }
}

/** A decoder for an MP3 that may still be downloading (`feed.ready()` must have resolved true). */
export function streamingMp3Decoder(ctx: BaseAudioContext, feed: Mp3Feed): StemDecoder {
  return new Mp3Decoder(ctx, feed)
}

/** Waveform of a complete MP3 / WAV, from a low-rate decode (see `createDecoder`'s `wantPeaks`). */
export async function peaksOfBytes(bytes: Uint8Array): Promise<number[]> {
  return peaksFromBytes(bytes.slice().buffer)
}

/**
 * `wantPeaks: false` skips the waveform (an extra low-rate decode of the whole file) for stems
 * whose manifest already carries one; `peaks` is then empty.
 */
export async function createDecoder(
  ctx: BaseAudioContext,
  blob: Blob,
  ext: string,
  wantPeaks = true,
): Promise<{ decoder: StemDecoder; peaks: number[]; kind: 'mp3' | 'wav' | 'full' }> {
  const bytes = await blob.arrayBuffer()
  const u8 = new Uint8Array(bytes)
  const peaksOf = async () => (wantPeaks ? peaksFromBytes(bytes) : [])
  if (ext === 'mp3') {
    const feed = new Mp3Feed(ByteStream.fromBytes(u8))
    if (feed.ix.snapshot()) return { decoder: new Mp3Decoder(ctx, feed), peaks: await peaksOf(), kind: 'mp3' }
  }
  if (ext === 'wav') {
    const w = parseWav(u8)
    if (w) return { decoder: new WavDecoder(ctx, blob, w), peaks: await peaksOf(), kind: 'wav' }
  }
  const buffer = await ctx.decodeAudioData(bytes)
  return { decoder: new FullDecoder(buffer), peaks: wantPeaks ? computePeaks(buffer) : [], kind: 'full' }
}

/** Native sample rate of an mp3/wav without decoding (null if unknown). */
export function sniffSampleRate(bytes: Uint8Array, ext: string): number | null {
  if (ext === 'mp3') return indexMp3(bytes)?.sampleRate ?? null
  if (ext === 'wav') return parseWav(bytes)?.rate ?? null
  return null
}
