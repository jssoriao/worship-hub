/**
 * Dev-only: serves a local folder of songs at /songs with the same layout the Worker
 * serves from R2 in production:
 *
 *   /songs/index.json                      -> [{ id, title }]   (id is the song's row id in the Neon dev database; title = folder name)
 *   /songs/<id>/stems/manifest.json        -> { title, stems: [{ file, name, group }] }
 *   /songs/<id>/stems/<file name>          -> audio bytes (Range supported)
 *
 * Each subfolder of the root is a song; nested folders become stem groups, and a file named like
 * its folder is that group's combined stem (see stemFiles). Audio is addressed by file name only.
 * The stems/ level leaves room for charts/ and lyrics/ next to it later. index.json and manifests
 * are generated on the fly.
 */
import { execFile, execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { assertDevIsNotProd, parseVars } from '../scripts/lib/env.ts'
import { createDevIds } from './dev-ids.ts'
import { suggestSections } from './sections.ts'
import { ANALYSIS_FILE, buildAnalysis, currentAnalysis } from './analysis.ts'

export const AUDIO = /\.(mp3|wav|m4a|aac|ogg|flac)$/i
export const MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  pro: 'text/plain; charset=utf-8',
}

/** The chart of a song: ChordPro text next to the stems, published as churches/<churchId>/songs/<songId>/chart.pro. */
export const CHART_FILE = 'chart.pro'

export const isDir = (p: string) => fs.existsSync(p) && fs.statSync(p).isDirectory()
const hidden = (n: string) => n.startsWith('.') || n === '__MACOSX'

export function listAudio(dir: string, rel: string[] = []): string[][] {
  const out: string[][] = []
  for (const name of fs.readdirSync(dir)) {
    if (hidden(name)) continue
    const full = path.join(dir, name)
    if (isDir(full)) out.push(...listAudio(full, [...rel, name]))
    else if (AUDIO.test(name)) out.push([...rel, name])
  }
  return out
}

/**
 * "Amazing Grace (Live)" -> "amazing-grace-live".
 * The slug is the song's id in URLs and R2 keys, so it must never change once a song is published.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** `dir` is the local folder name. It is the display title and the source of the slug, never sent to clients. */
export type LocalSong = { id: string; title: string; dir: string }

/** Every subfolder of `root` that contains audio is a song. */
export function listSongs(root: string): LocalSong[] {
  if (!isDir(root)) return []
  const songs = fs
    .readdirSync(root)
    .filter((n) => !hidden(n) && isDir(path.join(root, n)) && listAudio(path.join(root, n)).length > 0)
    .sort((a, b) => a.localeCompare(b))
    .map((n) => ({ id: slugify(n), title: n, dir: n }))
  const seen = new Map<string, string>()
  for (const song of songs) {
    if (!song.id) throw new Error(`Cannot make a URL slug from the folder name "${song.dir}". Rename it with letters or digits.`)
    const other = seen.get(song.id)
    if (other) throw new Error(`Folders "${other}" and "${song.dir}" both become the slug "${song.id}". Rename one.`)
    seen.set(song.id, song.dir)
  }
  return songs
}

/** Folders with a chart but no audio: songs made in the app before any stems exist. */
export function listChartOnly(root: string): LocalSong[] {
  if (!isDir(root)) return []
  return fs
    .readdirSync(root)
    .filter((n) => !hidden(n) && isDir(path.join(root, n)) && listAudio(path.join(root, n)).length === 0 && fs.existsSync(path.join(root, n, CHART_FILE)))
    .sort((a, b) => a.localeCompare(b))
    .map((n) => ({ id: slugify(n), title: n, dir: n }))
    .filter((s) => s.id !== '')
}

export interface StemFile {
  /** path inside the song folder */
  parts: string[]
  /** file name only. This is the stem's key in R2 and in manifests, so regrouping never moves audio */
  base: string
  /** folders above the file, e.g. "Drums" */
  group: string
  /** the combined stem of its group: a file named like its folder (drums/drums.mp3) */
  mix: boolean
}

/** "Lead_Vocals.mp3" and "lead vocals" compare equal */
const norm = (s: string) => s.replace(AUDIO, '').toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Every stem in a song folder. Folders become groups. A file named like its folder is that group's
 * combined stem ("mix"), and the other files in the folder are its parts. File names must be unique
 * within a song because they double as keys.
 */
export function stemFiles(songDir: string): StemFile[] {
  const files = listAudio(songDir)
  // drop a single wrapping folder, same as the zip loader
  const roots = new Set(files.map((f) => (f.length > 1 ? f[0] : '')))
  const strip = roots.size === 1 && !roots.has('')
  const seen = new Map<string, string>()
  const withMix = new Set<string>()
  return files.map((parts) => {
    const base = parts[parts.length - 1]
    const other = seen.get(base.toLowerCase())
    if (other) {
      throw new Error(`Two files in this song are named "${base}" (${other} and ${parts.join('/')}). Rename one: file names must be unique.`)
    }
    seen.set(base.toLowerCase(), parts.join('/'))
    const folders = parts.slice(strip ? 1 : 0, -1)
    const group = folders.join(' / ')
    const mix = folders.length > 0 && !withMix.has(group) && norm(base) === norm(folders[folders.length - 1])
    if (mix) withMix.add(group)
    return { parts, base, group, mix }
  })
}

const PEAK_BARS = 600 // same as src/lib/decoders.ts, so every waveform looks alike
const peakCache = new Map<string, number[] | null>()
let warnedNoFfmpeg = false

/**
 * The stem's waveform as PEAK_BARS bytes (0..255), computed like computePeaks in the browser: the
 * loudest sample per bar, from an 8 kHz decode. Stored in the manifest so the app can draw every
 * stem, even ones it has not downloaded. Needs ffmpeg; returns null when that is missing or cannot
 * read the file, and the app then draws the waveform after downloading the audio, as before.
 */
export function peaksFor(file: string): number[] | null {
  const st = fs.statSync(file)
  const key = `${file}:${st.size}:${st.mtimeMs}`
  const cached = peakCache.get(key)
  if (cached !== undefined) return cached
  let peaks: number[] | null = null
  try {
    const out = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-ac', '2', '-ar', '8000', '-f', 'f32le', 'pipe:1'], {
      maxBuffer: 1 << 30,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    // copy: a Buffer's byteOffset is not always 4-byte aligned
    const samples = new Float32Array(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength - (out.byteLength % 4)))
    const frames = Math.floor(samples.length / 2)
    const block = Math.max(1, Math.floor(frames / PEAK_BARS))
    peaks = new Array<number>(PEAK_BARS).fill(0)
    for (let i = 0; i < PEAK_BARS; i++) {
      const start = i * block
      const end = Math.min(frames, start + block)
      const stride = Math.max(1, Math.floor((end - start) / 200))
      let max = 0
      for (let f = start; f < end; f += stride) {
        max = Math.max(max, Math.abs(samples[2 * f]), Math.abs(samples[2 * f + 1]))
      }
      peaks[i] = Math.round(Math.min(1, max) * 255)
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      if (!warnedNoFfmpeg) console.warn('ffmpeg not found: manifests get no waveforms (the app draws them after download).')
      warnedNoFfmpeg = true
    } else {
      console.warn(`Could not make a waveform for ${path.basename(file)}; the app will draw it after download.`)
    }
  }
  peakCache.set(key, peaks)
  return peaks
}

/**
 * Key, tempo and beats of a song, from the analysis files next to its stems (Loop Mastering's
 * key_analysis.json and beat_grid.json), with song.json able to correct them:
 *   { "key": "Ab", "bpm": 63, "meter": 4 }
 * A corrected meter re-places the accents: every `meter` beats from the first detected downbeat.
 * Beat times are whole milliseconds; `downbeats` are indexes into `beats`. Nothing is returned when
 * the song has none of these files.
 */
export function songMusic(songDir: string): SongMusic | undefined {
  const read = (name: string): Record<string, unknown> | undefined => {
    const file = path.join(songDir, name)
    if (!fs.existsSync(file)) return undefined
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>
    } catch {
      console.warn(`Could not read ${file}; ignoring it.`)
      return undefined
    }
  }
  const keyFile = read('key_analysis.json') as { summary?: { key?: { short?: string } } } | undefined
  const gridFile = read('beat_grid.json') as
    | { summary?: { displayBpm?: number; meter?: { numerator?: number } }; beats?: [number, number, number?][] }
    | undefined
  const own = read('song.json') as { key?: unknown; bpm?: unknown; meter?: unknown; sections?: unknown } | undefined
  if (!keyFile && !gridFile && !own) return undefined

  const music: SongMusic = {}
  const key = typeof own?.key === 'string' ? own.key : keyFile?.summary?.key?.short
  if (key) music.key = key
  const bpm = typeof own?.bpm === 'number' ? own.bpm : gridFile?.summary?.displayBpm
  if (typeof bpm === 'number' && bpm > 0) music.bpm = Math.round(bpm * 10) / 10
  const meter = typeof own?.meter === 'number' ? own.meter : gridFile?.summary?.meter?.numerator
  if (typeof meter === 'number' && meter >= 1 && meter <= 16) music.meter = Math.round(meter)

  const raw = Array.isArray(gridFile?.beats) ? gridFile.beats.filter((b) => Array.isArray(b) && typeof b[0] === 'number') : []
  if (raw.length > 0) {
    music.beats = raw.map((b) => Math.round(b[0] * 1000))
    const detected = raw.flatMap((b, i) => (b[1] === 1 ? [i] : []))
    if (typeof own?.meter === 'number' && music.meter) {
      const first = detected[0] ?? 0
      music.downbeats = music.beats.flatMap((_, i) => (i >= first && (i - first) % music.meter! === 0 ? [i] : []))
    } else {
      music.downbeats = detected
    }
  }

  // sections: the ones in song.json, else suggested from the stems
  if (Array.isArray(own?.sections)) {
    music.sections = own.sections.flatMap((x: unknown) => {
      const s = x as { t?: unknown; label?: unknown }
      const t = typeof s.t === 'number' ? s.t : typeof s.t === 'string' ? clock(s.t) : null
      return t !== null && t >= 0 && typeof s.label === 'string' ? [{ t: Math.round(t * 1000), label: s.label.slice(0, 40) }] : []
    })
  } else if (currentAnalysis(songDir)?.sections.length) {
    // sections with real labels from the analysis (Intro, Verse, Chorus…)
    music.sections = currentAnalysis(songDir)!.sections.map(([t, , label]) => ({ t, label }))
  } else if (music.beats && music.downbeats && music.downbeats.length > 0) {
    const files = stemFiles(songDir)
    const full = (f: StemFile) => path.join(songDir, ...f.parts)
    const combined = new Set(files.filter((f) => f.mix).map((f) => f.group))
    const mains = files.filter((f) => f.mix || !combined.has(f.group))
    const named = (re: RegExp) => files.find((f) => re.test(f.base))
    const lead = named(/lead[ _-]?vocals?\./i) ?? files.find((f) => f.mix && /vocal/i.test(f.group)) ?? named(/vocals?\./i)
    const drums = files.find((f) => f.mix && /drum/i.test(f.group)) ?? named(/^drums?\./i)
    const found = suggestSections(
      music.downbeats.map((i) => music.beats![i] / 1000),
      lead ? full(lead) : null,
      drums ? full(drums) : null,
      mains.map(full),
    )
    if (found.length > 1) music.sections = found
  }
  return music
}

/** "1:23.5" or "83.5" -> seconds, or null. */
function clock(value: string): number | null {
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(value.trim())
  return m ? (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]) : null
}

export interface SongMusic {
  /** e.g. "D", "Bm", "Ab" */
  key?: string
  bpm?: number
  /** beats per bar */
  meter?: number
  /** every beat, in milliseconds from the start */
  beats?: number[]
  /** indexes into `beats` of the first beat of each bar */
  downbeats?: number[]
  /** where sections start (ms, on bars) and what they are: from song.json, or suggested from the stems */
  sections?: { t: number; label: string }[]
}

/**
 * `withPeaks` adds each stem's waveform (needs ffmpeg; slow on first use, then cached). `tiers` lists
 * the qualities the song is available in, with their download size when known (see TIERS).
 */
export function manifest(
  songDir: string,
  title: string,
  withPeaks = false,
  tiers?: { id: string; bytes?: number }[],
  /** per file name and tier: the fingerprint of the file's content (see fileHash) */
  versions?: Record<string, Record<string, string>>,
) {
  const music = songMusic(songDir)
  return {
    title,
    ...(tiers ? { tiers } : {}),
    ...(music ? { music } : {}),
    stems: stemFiles(songDir).map((f) => {
      const peaks = withPeaks ? peaksFor(path.join(songDir, ...f.parts)) : null
      const v = versions?.[f.base]
      return {
        file: encodeURIComponent(f.base),
        name: f.base.replace(AUDIO, '').replace(/_+/g, ' ').trim(),
        group: f.group,
        ...(f.mix ? { mix: true } : {}),
        ...(peaks ? { peaks } : {}),
        ...(v && Object.keys(v).length ? { v } : {}),
      }
    }),
  }
}

/**
 * Download qualities. "standard" and "saver" are the stems re-encoded with ffmpeg as LAME variable
 * bitrate MP3 (`q`: lower is bigger and better). "original" is the file as it is. In R2 and on the
 * dev server the original sits next to the manifest (stems/<file>), the others in stems/<tier>/<file>.
 */
export const TIERS: { id: string; q: number | null }[] = [
  { id: 'standard', q: 4 },
  { id: 'saver', q: 6 },
  { id: 'original', q: null },
]

/** Path of a stem inside stems/ for a tier. */
export const tierPath = (tier: string, base: string) => (tier === 'original' ? base : `${tier}/${base}`)

const execFileAsync = promisify(execFile)
const variantDir = path.join(os.tmpdir(), 'worship-hub-variants')
const inflight = new Map<string, Promise<string>>()
const MAX_ENCODES = 3
let encoding = 0
const queued: (() => void)[] = []

/** At most MAX_ENCODES ffmpeg runs at once, so opening a song does not start dozens of them. */
async function inSlot<T>(task: () => Promise<T>): Promise<T> {
  if (encoding >= MAX_ENCODES) await new Promise<void>((resolve) => queued.push(resolve))
  encoding++
  try {
    return await task()
  } finally {
    encoding--
    queued.shift()?.()
  }
}

/** Where the re-encoded copy of `src` at quality `q` lives in the cache (it may not exist yet). */
function variantPath(src: string, q: number) {
  const st = fs.statSync(src)
  const key = crypto.createHash('sha1').update(`${src}:${st.size}:${st.mtimeMs}:q${q}`).digest('hex').slice(0, 20)
  return path.join(variantDir, `${key}.mp3`)
}

/** The stem re-encoded as a VBR MP3, made with ffmpeg on first use and cached in the temp folder. */
export function variantFile(src: string, q: number): Promise<string> {
  const out = variantPath(src, q)
  if (fs.existsSync(out)) return Promise.resolve(out)
  let pending = inflight.get(out)
  if (!pending) {
    pending = inSlot(async () => {
      fs.mkdirSync(variantDir, { recursive: true })
      const part = `${out}.${process.pid}.part`
      await execFileAsync('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vn', '-map_metadata', '-1', '-c:a', 'libmp3lame', '-q:a', String(q), '-f', 'mp3', part])
      fs.renameSync(part, out)
      return out
    }).finally(() => inflight.delete(out))
    inflight.set(out, pending)
  }
  return pending
}

const warmed = new Set<string>()

/** When a song is opened, make its other qualities in the background so switching is quick. */
function warmVariants(songDir: string) {
  if (warmed.has(songDir)) return
  warmed.add(songDir)
  for (const tier of TIERS) {
    if (tier.q === null) continue
    for (const f of stemFiles(songDir)) variantFile(path.join(songDir, ...f.parts), tier.q).catch(() => {})
  }
}

const hashes = new Map<string, string>()

/**
 * Fingerprint of a file's content: the start of its SHA-256 in hex. It goes into the file's address
 * (?v=...), so the same address always means the same bytes and the file can be cached for good.
 */
export function fileHash(file: string): string {
  const st = fs.statSync(file)
  const key = `${file}:${st.size}:${st.mtimeMs}`
  let hash = hashes.get(key)
  if (!hash) {
    hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16)
    hashes.set(key, hash)
  }
  return hash
}

/** The re-encoded copy of `src` at quality `q` if it has been made already, else undefined. */
export function cachedVariant(src: string, q: number): string | undefined {
  const file = variantPath(src, q)
  return fs.existsSync(file) ? file : undefined
}

/** Fingerprints of what the dev server serves: the originals, and re-encodes that are already made. */
function devVersions(songDir: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  for (const f of stemFiles(songDir)) {
    const src = path.join(songDir, ...f.parts)
    for (const tier of TIERS) {
      const file = tier.q === null ? src : cachedVariant(src, tier.q)
      if (file) (out[f.base] ??= {})[tier.id] = fileHash(file)
    }
  }
  return out
}

/**
 * Every tier with its total size, where that is already known without encoding: always for the
 * original, and for the others once all their files are in the cache. The dev server offers all of them.
 */
export function tierSizes(songDir: string) {
  const files = stemFiles(songDir).map((f) => path.join(songDir, ...f.parts))
  return TIERS.map((tier) => {
    const sizes = files.map((src) => {
      const file = tier.q === null ? src : variantPath(src, tier.q)
      return fs.existsSync(file) ? fs.statSync(file).size : null
    })
    return { id: tier.id, ...(sizes.every((s) => s !== null) ? { bytes: sizes.reduce((a, b) => a + (b ?? 0), 0) } : {}) }
  })
}

function json(res: ServerResponse, body: unknown) {
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function sendFile(req: IncomingMessage, res: ServerResponse, file: string) {
  const size = fs.statSync(file).size
  res.setHeader('Content-Type', MIME[path.extname(file).slice(1).toLowerCase()] ?? 'application/octet-stream')
  res.setHeader('Accept-Ranges', 'bytes')
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '')
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : size - Number(m[2])
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1
    if (start > end || start >= size) {
      res.statusCode = 416
      res.setHeader('Content-Range', `bytes */${size}`)
      return res.end()
    }
    res.statusCode = 206
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
    res.setHeader('Content-Length', end - start + 1)
    return fs.createReadStream(file, { start, end }).pipe(res)
  }
  res.setHeader('Content-Length', size)
  fs.createReadStream(file).pipe(res)
}

export function songsPlugin(rootDir: string, mount = '/songs'): Plugin {
  const root = path.resolve(rootDir)
  return {
    name: 'worship-hub-songs',
    apply: 'serve',
    configureServer(server) {
      const devIds = createDevIds()
      // dev must never point at the production database
      try {
        const url = parseVars(fs.readFileSync('.dev.vars', 'utf8')).DATABASE_URL
        if (url) assertDevIsNotProd(url)
      } catch {
        // no .dev.vars: reported when the first song id is needed
      }
      server.middlewares.use(mount, async (req, res, next) => {
        try {
          const segs = new URL(req.url ?? '/', 'http://x').pathname
            .split('/')
            .filter(Boolean)
            .map(decodeURIComponent)
          if (segs.some((s) => s === '..' || s.includes('\0'))) {
            res.statusCode = 400
            return res.end()
          }
          if (!isDir(root)) return json(res, [])

          // The folder name is the title; the song's id is its row in the Neon dev database (see dev-ids.ts)
          const localSongs = listSongs(root)
          const localChart = listChartOnly(root).filter((c) => !localSongs.some((s) => s.id === c.id))
          const ids = await devIds.resolve([...localSongs.map((s) => ({ title: s.title, stems: true })), ...localChart.map((s) => ({ title: s.title, stems: false }))])
          const songs = localSongs.map((s) => ({ ...s, id: ids.get(s.title)! }))
          const chartOnly = localChart.map((s) => ({ ...s, id: ids.get(s.title)! }))
          if (segs.length === 1 && segs[0] === 'index.json') {
            return json(
              res,
              [...songs.map(({ id, title }) => ({ id, title })), ...chartOnly.map(({ id, title }) => ({ id, title, stems: false }))].sort((a, b) =>
                a.title.localeCompare(b.title),
              ),
            )
          }
          // POST /songs/new {title}: a folder for a song that has a chart but no stems yet
          if (req.method === 'POST' && segs.length === 1 && segs[0] === 'new') {
            let body = ''
            req.on('data', (c: Buffer) => {
              if (body.length < 4096) body += c.toString()
            })
            req.on('end', async () => {
              let title = ''
              try {
                title = String((JSON.parse(body || '{}') as { title?: unknown }).title ?? '')
              } catch {
                // bad JSON: treated as no title
              }
              // a folder name: no path separators or leading dots
              title = title.trim().slice(0, 120).replace(/[\\/\0]/g, ' ').replace(/^\.+/, '').trim()
              const id = slugify(title)
              if (!id || id === 'new') {
                res.statusCode = 400
                return res.end('Give the song a title with letters or digits')
              }
              if ([...songs, ...chartOnly].some((s) => s.title.toLowerCase() === title.toLowerCase() || slugify(s.title) === id)) {
                res.statusCode = 409
                return res.end('A song with this name exists already')
              }
              try {
                fs.mkdirSync(path.join(root, title))
                fs.writeFileSync(path.join(root, title, CHART_FILE), '')
                const made = await devIds.resolve([{ title, stems: false }])
                res.statusCode = 201
                json(res, { id: made.get(title)!, title, stems: false })
              } catch (e) {
                res.statusCode = 500
                res.end(e instanceof Error ? e.message : 'Could not add the song')
              }
            })
            return
          }

          const song = [...songs, ...chartOnly].find((s) => s.id === segs[0])
          // /songs/<id>/arrangements/[<id>.json]: arrangements, kept in the song folder (dev has no sign-in)
          if (song && segs[1] === 'arrangements' && segs.length <= 3) {
            const dir = path.join(root, song.dir, 'arrangements')
            const id = segs[2]?.replace(/\.json$/, '')
            if (id !== undefined && !/^[A-Za-z0-9_-]{6,32}$/.test(id)) {
              res.statusCode = 404
              return res.end()
            }
            const file = id ? path.join(dir, `${id}.json`) : ''
            if (!id && req.method === 'GET') {
              const list = isDir(dir)
                ? fs
                    .readdirSync(dir)
                    .filter((n) => n.endsWith('.json'))
                    .flatMap((n) => {
                      try {
                        const a = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')) as Record<string, string>
                        return [{ id: n.replace(/\.json$/, ''), name: a.name ?? 'Arrangement', owner: a.owner ?? '', ownerName: 'dev', updated: a.updated ?? '' }]
                      } catch {
                        return []
                      }
                    })
                    .sort((a, b) => b.updated.localeCompare(a.updated))
                : []
              return json(res, list)
            }
            if (id && req.method === 'GET') {
              if (!fs.existsSync(file)) {
                res.statusCode = 404
                return res.end()
              }
              res.setHeader('Content-Type', 'application/json')
              return res.end(fs.readFileSync(file))
            }
            if (id && req.method === 'DELETE') {
              if (fs.existsSync(file)) fs.unlinkSync(file)
              return json(res, { ok: true })
            }
            if (id && req.method === 'PUT') {
              let body = ''
              req.on('data', (c: Buffer) => {
                if (body.length <= 100 * 1024) body += c.toString()
              })
              req.on('end', () => {
                try {
                  const data = JSON.parse(body) as Record<string, unknown>
                  const stored = { ...data, id, song: song.id, owner: 'dev', updated: new Date().toISOString() }
                  fs.mkdirSync(dir, { recursive: true })
                  fs.writeFileSync(file, JSON.stringify(stored))
                  json(res, stored)
                } catch {
                  res.statusCode = 400
                  res.end('Bad Request')
                }
              })
              return
            }
            res.statusCode = 405
            return res.end()
          }
          // /songs/<id>/analysis.json: chords, beats, sections and timed lyrics (see analysis.ts)
          if (song && segs.length === 2 && segs[1] === ANALYSIS_FILE) {
            const dir = path.join(root, song.dir, 'analysis')
            const edited = path.join(dir, ANALYSIS_FILE)
            if (req.method === 'PUT') {
              let body = ''
              req.on('data', (c: Buffer) => {
                if (body.length <= 1024 * 1024) body += c.toString()
              })
              req.on('end', () => {
                try {
                  const data = JSON.parse(body) as { v?: unknown }
                  if (data.v !== 1) throw new Error('not an analysis')
                  const history = path.join(dir, 'history')
                  fs.mkdirSync(history, { recursive: true })
                  const before = fs.existsSync(edited) ? fs.readFileSync(edited, 'utf8') : JSON.stringify(buildAnalysis(path.join(root, song.dir)))
                  fs.writeFileSync(path.join(history, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`), before)
                  fs.writeFileSync(edited, JSON.stringify(data))
                  json(res, { ok: true, updatedAt: new Date().toISOString() })
                } catch {
                  res.statusCode = 400
                  res.end('Bad Request')
                }
              })
              return
            }
            // an edited copy wins over the one made from the raw results
            if (fs.existsSync(edited)) return json(res, JSON.parse(fs.readFileSync(edited, 'utf8')))
            const a = buildAnalysis(path.join(root, song.dir))
            if (!a) {
              res.statusCode = 404
              return res.end('Not analysed')
            }
            return json(res, a)
          }
          // /songs/<id>/analysis/history/[<file>]: earlier versions of an edited analysis
          if (song && segs[1] === 'analysis' && segs[2] === 'history') {
            const history = path.join(root, song.dir, 'analysis', 'history')
            const file = segs[3]
            if (!file) {
              const list = isDir(history)
                ? fs.readdirSync(history).filter((n) => n.endsWith('.json')).sort().reverse().map((n) => ({ file: n, savedAt: fs.statSync(path.join(history, n)).mtime.toISOString(), savedBy: 'dev' }))
                : []
              return json(res, list)
            }
            if (!/^[\w-]+\.json$/.test(file) || !fs.existsSync(path.join(history, file))) {
              res.statusCode = 404
              return res.end()
            }
            res.setHeader('Content-Type', 'application/json')
            return res.end(fs.readFileSync(path.join(history, file)))
          }
          // /songs/<id>/chart.pro: the song's chord chart (ChordPro text), optional
          if (song && segs.length === 2 && segs[1] === CHART_FILE) {
            const file = path.join(root, song.dir, CHART_FILE)
            if (req.method === 'PUT') {
              const chunks: Buffer[] = []
              let size = 0
              req.on('data', (c: Buffer) => {
                size += c.length
                if (size <= 200 * 1024) chunks.push(c)
              })
              req.on('end', () => {
                if (size > 200 * 1024) {
                  res.statusCode = 413
                  return res.end('Chart too large')
                }
                fs.writeFileSync(file, Buffer.concat(chunks))
                res.statusCode = 204
                res.end()
              })
              return
            }
            if (!fs.existsSync(file)) {
              res.statusCode = 404
              return res.end('No chart')
            }
            res.setHeader('Cache-Control', 'no-cache')
            return sendFile(req, res, file)
          }
          // /songs/<id>/stems/...
          if (!song || segs[1] !== 'stems' || segs.length < 3) return next()
          const songDir = path.join(root, song.dir)
          let rest = segs.slice(2)
          // /songs/<id>/stems/<standard|saver>/<file>: the stem re-encoded (see TIERS)
          const tier = rest.length === 2 ? TIERS.find((t) => t.id === rest[0] && t.q !== null) : undefined
          if (tier) rest = rest.slice(1)
          if (rest.length === 1 && rest[0] === 'manifest.json' && !tier) {
            warmVariants(songDir)
            return json(res, manifest(songDir, song.title, true, tierSizes(songDir), devVersions(songDir)))
          }
          // stems are addressed by file name only, wherever they sit in the song folder
          const stem = rest.length === 1 ? stemFiles(songDir).find((f) => f.base === rest[0]) : undefined
          if (!stem) return next()
          const full = path.join(songDir, ...stem.parts)
          if (!full.startsWith(songDir + path.sep)) {
            res.statusCode = 400
            return res.end()
          }
          if (tier?.q != null) {
            variantFile(full, tier.q).then((out) => sendFile(req, res, out), next)
            return
          }
          return sendFile(req, res, full)
        } catch (e) {
          // the song ids come from the database: say what is wrong rather than a blank 500
          res.statusCode = 503
          res.setHeader('Content-Type', 'text/plain')
          res.end(e instanceof Error ? e.message : 'Song list unavailable')
        }
      })
    },
  }
}
