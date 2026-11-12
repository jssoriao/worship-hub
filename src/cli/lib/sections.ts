/**
 * Suggested sections of a song, found from its stems at publish time (see songMusic in
 * song-files.ts). Boundaries are on bars of the beat grid, where:
 *   - the lead vocal comes in or stops for a few bars,
 *   - the drums come in or drop out,
 *   - in a long stretch with neither, the overall loudness steps up or down (a verse into a chorus).
 * Labels are only what the stems can tell: Intro (before the first vocal), Instrumental (no vocal
 * between sung parts), Outro (after the last vocal), and "Part n" for the rest, to be renamed.
 */
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const RATE = 2000 // Hz: enough for loudness, small to keep
const HOP = 100 // samples per loudness value (50 ms)
const cacheDir = path.join(os.tmpdir(), 'worship-hub-envelopes')
const memory = new Map<string, Float32Array | null>()

/** Loudness (RMS) of a file every 50 ms, from a mono decode. Cached in memory and in the temp folder. */
export function envelope(file: string): Float32Array | null {
  const st = fs.statSync(file)
  const key = crypto.createHash('sha1').update(`${path.resolve(file)}:${st.size}:${st.mtimeMs}`).digest('hex').slice(0, 20)
  if (memory.has(key)) return memory.get(key)!
  const cached = path.join(cacheDir, `${key}.f32`)
  let env: Float32Array | null = null
  try {
    if (fs.existsSync(cached)) {
      const b = fs.readFileSync(cached)
      env = new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
    } else {
      const out = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(RATE), '-f', 'f32le', 'pipe:1'], {
        maxBuffer: 1 << 28,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      const s = new Float32Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength - (out.byteLength % 4)))
      env = new Float32Array(Math.floor(s.length / HOP))
      for (let i = 0; i < env.length; i++) {
        let sum = 0
        for (let j = i * HOP; j < (i + 1) * HOP; j++) sum += s[j] * s[j]
        env[i] = Math.sqrt(sum / HOP)
      }
      fs.mkdirSync(cacheDir, { recursive: true })
      fs.writeFileSync(cached, Buffer.from(env.buffer))
    }
  } catch {
    env = null // no ffmpeg, or an unreadable file: no suggestions
  }
  memory.set(key, env)
  return env
}

const SEC_PER_VALUE = HOP / RATE
const dB = (x: number) => 10 * Math.log10(x + 1e-10)

/** Per bar: loudness in dB, and the share of the bar that is clearly sounding. */
function perBar(env: Float32Array, bars: [number, number][]) {
  const all = Array.from(env)
    .filter((v) => v > 1e-5)
    .sort((a, b) => a - b)
  const ref = all.length ? all[Math.floor(all.length * 0.95)] : 1
  const on = ref * 0.1 // within 20 dB of the stem's loud parts
  return bars.map(([a, b]) => {
    const i0 = Math.floor(a / SEC_PER_VALUE)
    const i1 = Math.max(i0 + 1, Math.floor(b / SEC_PER_VALUE))
    let sq = 0
    let n = 0
    let sounding = 0
    for (let i = i0; i < i1 && i < env.length; i++) {
      sq += env[i] * env[i]
      n++
      if (env[i] > on) sounding++
    }
    return { db: dB(n ? sq / n : 0), share: n ? sounding / n : 0 }
  })
}

/** On/off per bar, with runs shorter than `minRun` bars taken as part of what surrounds them. */
function activity(shares: number[], threshold: number, minRun: number): boolean[] {
  const act = shares.map((s) => s >= threshold)
  for (let pass = 0; pass < 2; pass++) {
    let i = 0
    while (i < act.length) {
      let j = i
      while (j < act.length && act[j] === act[i]) j++
      const inside = i > 0 && j < act.length
      if (inside && j - i < minRun) for (let k = i; k < j; k++) act[k] = !act[k]
      i = j
    }
  }
  return act
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

export interface Suggested {
  /** ms */
  t: number
  label: string
}

/**
 * `downbeats` in seconds. `lead` is the lead vocal (or all vocals), `drums` the drums, `mains` the
 * main stems (combined stems and stems on their own, so nothing is counted twice) for the loudness.
 */
export function suggestSections(downbeats: number[], lead: string | null, drums: string | null, mains: string[]): Suggested[] {
  if (downbeats.length < 8 || !lead) return []
  const leadEnv = envelope(lead)
  if (!leadEnv) return []
  const duration = leadEnv.length * SEC_PER_VALUE
  const bars: [number, number][] = downbeats.filter((t) => t < duration).map((t, i, all) => [t, i + 1 < all.length ? all[i + 1] : duration])
  const leadBars = perBar(leadEnv, bars)
  const vocal = activity(leadBars.map((b) => b.share), 0.3, 3)
  // a bar where the singer rests (before smoothing): lines and sections often end there
  const rest = leadBars.map((b) => b.share < 0.3)
  const drumEnv = drums ? envelope(drums) : null
  const drumBars = drumEnv ? perBar(drumEnv, bars) : null
  const drumOn = drumBars ? activity(drumBars.map((b) => b.share), 0.3, 2) : null
  // the loudness of everything (main stems summed in power)
  const envs = mains.map(envelope).filter((e): e is Float32Array => e !== null)
  const loud = envs.map((e) => perBar(e, bars).map((b) => Math.pow(10, b.db / 10)))
  const total = bars.map((_, k) => dB(loud.reduce((sum, l) => sum + l[k], 0)))

  // bars where something starts or stops
  const cuts = new Set<number>()
  for (let k = 1; k < bars.length; k++) {
    if (vocal[k] !== vocal[k - 1]) cuts.add(k)
    if (drumOn && drumOn[k] !== drumOn[k - 1]) cuts.add(k)
  }
  // too close together: keep the first (a vocal entry and a drum fill a bar apart are one change)
  const kept: number[] = []
  for (const k of [...cuts].sort((a, b) => a - b)) if (k >= 2 && (kept.length === 0 || k - kept[kept.length - 1] >= 3)) kept.push(k)

  // long stretches: split on a 4-bar phrase (from the stretch start) where the singer rests just
  // before, or the loudness or the drums step up or down; nothing stays longer than MAX_BARS
  const MAX_BARS = 32
  const bounds = [0, ...kept, bars.length]
  const out: number[] = [0]
  const drumDb = drumBars?.map((b) => b.db)
  const step = (xs: number[], j: number) => Math.abs(mean(xs.slice(j, j + 4)) - mean(xs.slice(j - 4, j)))
  const split = (a: number, b: number) => {
    if (b - a <= 16) return
    let best = -1
    let score = 0
    for (let j = a + 8; j <= b - 8; j += 4) {
      const restBefore = rest[j - 1] || (rest[j - 2] && !rest[j - 1]) ? 3 : 0
      const sc = restBefore + step(total, j) + (drumDb ? step(drumDb, j) * 0.5 : 0) + (j - a === 16 || j - a === 8 ? 0.3 : 0)
      if (sc > score) {
        score = sc
        best = j
      }
    }
    if (best < 0 || (score < 2 && b - a <= MAX_BARS)) return
    split(a, best)
    out.push(best)
    split(best, b)
  }
  for (let i = 0; i + 1 < bounds.length; i++) {
    if (i > 0) out.push(bounds[i])
    split(bounds[i], bounds[i + 1])
  }
  const starts = [...new Set(out)].sort((a, b) => a - b)

  // labels from the vocal
  const sung = starts.map((s, i) => {
    const e = i + 1 < starts.length ? starts[i + 1] : bars.length
    return vocal.slice(s, e).filter(Boolean).length / Math.max(1, e - s) > 0.15
  })
  const firstSung = sung.indexOf(true)
  const lastSung = sung.lastIndexOf(true)
  let n = 0
  return starts.map((s, i) => {
    const label = sung[i] ? `Part ${++n}` : firstSung < 0 || i < firstSung ? 'Intro' : i > lastSung ? 'Outro' : 'Instrumental'
    return { t: i === 0 ? 0 : Math.round(bars[s][0] * 1000), label }
  })
}
