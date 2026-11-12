import JSZip from 'jszip'
import { audioCache } from './audio-cache'

/**
 * A stem source only knows how to produce its (compressed) bytes.
 * Zip, local dev server and S3/CloudFront all map onto this.
 */
export interface StemSource {
  id: string
  name: string
  group: string
  /** the combined stem of its group, with the other stems in that group as its parts (see mix.ts) */
  mix?: boolean
  /** waveform (0..1) known up front, so it can be drawn before the audio is downloaded */
  peaks?: number[]
  ext: string
  getBlob(): Promise<Blob>
  /** Library files: the address to stream from (the engine uses this instead of getBlob for MP3). */
  url?: string
  /** Fingerprint of the file's content; in `url` as ?v=. Files that have one can be saved on the device. */
  version?: string
  /** What the file is saved under on the device ("<song>|<quality>"). */
  cacheGroup?: string
}

export const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|flac)$/i

const extOf = (file: string) => file.split('.').pop()!.toLowerCase()

export function prettyName(file: string) {
  return file.replace(AUDIO_EXT, '').replace(/_+/g, ' ').trim()
}

/**
 * The order a band reads a mix in: click, vocals, drums, bass, guitars, keys, then anything else,
 * with "other" last. It goes by the top-level folder when there is one, otherwise by the stem name.
 */
const ORDER: [RegExp, number][] = [
  [/^(metronome|click)/, 0],
  [/vocal|vox/, 1],
  [/drum|perc|kick|snare|tom|cymbal|hat/, 2],
  [/bass/, 3],
  [/guitar|gtr/, 4],
  [/piano|keys|keyboard/, 5],
  [/^other/, 9],
]
const OTHER_STUFF = 6 // between keys and "other"

const unitOf = (s: StemSource) => (s.group ? s.group.split(' / ')[0] : s.name)
const rankOf = (unit: string) => ORDER.find(([re]) => re.test(unit.toLowerCase()))?.[1] ?? OTHER_STUFF

// Stems of a group stay together, with the combined stem first and then the parts.
const sortStems = (a: StemSource, b: StemSource) =>
  rankOf(unitOf(a)) - rankOf(unitOf(b)) ||
  unitOf(a).localeCompare(unitOf(b), undefined, { numeric: true }) ||
  a.group.localeCompare(b.group) ||
  Number(b.mix === true) - Number(a.mix === true) ||
  a.name.localeCompare(b.name, undefined, { numeric: true })

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** Checks the shape of a manifest. `where` names it in error messages. */
function checkManifest(data: unknown, where: string): SongManifest {
  const stems = (data as { stems?: unknown } | null)?.stems
  if (!Array.isArray(stems) || stems.length === 0 || stems.some((s) => typeof (s as { file?: unknown })?.file !== 'string')) {
    throw new Error(`${where} needs a "stems" list where every item has a "file".`)
  }
  return data as SongManifest
}

// ---------------------------------------------------------------- zip

/**
 * Opens a zip of stems. If the zip has a manifest.json (at its root, or inside the one folder that
 * wraps everything) the manifest decides names, groups and combined stems, exactly as for library
 * songs. Without one, folders become plain group labels, with no combined stems.
 */
export async function sourcesFromZip(file: File): Promise<StemSource[]> {
  const zip = await JSZip.loadAsync(file)
  const entries = Object.values(zip.files).filter(
    (e) =>
      !e.dir &&
      AUDIO_EXT.test(e.name) &&
      !e.name.startsWith('__MACOSX/') &&
      !e.name.split('/').pop()!.startsWith('.'),
  )
  if (entries.length === 0) throw new Error('No mp3/wav files found in the zip.')

  // If every file sits inside one shared top-level folder (e.g. macOS "Compress"), drop it.
  const roots = new Set(entries.map((e) => (e.name.includes('/') ? e.name.split('/')[0] : '')))
  const stripRoot = roots.size === 1 && !roots.has('')

  const dir = stripRoot ? `${[...roots][0]}/` : ''
  const manifestFile = zip.file(`${dir}manifest.json`)
  if (manifestFile) {
    let data: unknown
    try {
      data = JSON.parse(await manifestFile.async('string'))
    } catch {
      throw new Error('manifest.json in the zip is not valid JSON.')
    }
    return checkManifest(data, 'manifest.json in the zip')
      .stems
      .map((s) => {
        const fileName = safeDecode(s.file)
        const entry = zip.file(dir + fileName) ?? zip.file(dir + s.file)
        if (!entry) throw new Error(`manifest.json lists "${fileName}", but it is not in the zip.`)
        const base = fileName.split('/').pop()!
        return {
          id: s.file,
          name: s.name ?? prettyName(base),
          group: s.group ?? '',
          mix: s.mix === true,
          peaks: peaksOf(s.peaks),
          ext: extOf(base),
          getBlob: () => entry.async('blob'),
        }
      })
      .sort(sortStems)
  }

  return entries
    .map((entry) => {
      const parts = entry.name.split('/')
      if (stripRoot) parts.shift()
      const base = parts.pop()!
      return {
        id: entry.name,
        name: prettyName(base),
        group: parts.join(' / '),
        ext: extOf(base),
        getBlob: () => entry.async('blob'),
      }
    })
    .sort(sortStems)
}

// ---------------------------------------------------------------- library (dev server / S3)

/** `${base}/index.json` */
export interface LibrarySong {
  id: string
  title: string
  artist?: string | null
  key?: string | null
  bpm?: number | null
  meter?: number | null
  /** false for a song made in the app that has a chart but no stems (yet) */
  stems?: boolean
}

/**
 * `${base}/${id}/stems/manifest.json`. `file` is relative to the manifest (and may be URL-encoded).
 * `mix: true` marks the combined stem of its group; the other stems in that group are its parts.
 * The same format works as manifest.json at the root of a zip.
 */
interface SongManifest {
  title?: string
  /**
   * `peaks` is the stem's waveform as bytes (0..255), made by songs:publish / songs:pack.
   * `v` fingerprints the file per quality (`{ standard: "ab12…", original: "…" }`): the hash of its
   * content. It goes into the URL, which is what makes long-term caching safe.
   */
  stems: { file: string; name?: string; group?: string; mix?: boolean; peaks?: number[]; v?: Record<string, string> }[]
  /**
   * Download qualities this song is published in, with their size in bytes when known. A tier's
   * files are at `<tier>/<file>` next to the manifest, except "original", which sits beside it.
   * Absent in older manifests and in zips: then `file` alone is the URL.
   */
  tiers?: { id: string; bytes?: number }[]
  /** key, tempo and beats (see songMusic in dev/songs-plugin.ts) */
  music?: unknown
}

/** Key, tempo and beat times of a song. Beats are seconds; `downbeats` index into them. */
export interface SongMusic {
  key?: string
  bpm?: number
  meter?: number
  beats: number[]
  downbeats: number[]
  /** suggested sections (seconds, on bars), when there is no chart with cues */
  sections: { t: number; label: string }[]
}

/** Checks what the manifest says about the music; anything malformed is left out. */
function musicOf(raw: unknown): SongMusic | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const m = raw as Record<string, unknown>
  const nums = (v: unknown) => (Array.isArray(v) && v.every((n) => typeof n === 'number' && Number.isFinite(n)) ? (v as number[]) : [])
  const beats = nums(m.beats).map((ms) => ms / 1000)
  const music: SongMusic = {
    ...(typeof m.key === 'string' && m.key ? { key: m.key } : {}),
    ...(typeof m.bpm === 'number' && m.bpm > 0 ? { bpm: m.bpm } : {}),
    ...(typeof m.meter === 'number' && m.meter > 0 ? { meter: m.meter } : {}),
    beats,
    downbeats: nums(m.downbeats).filter((i) => Number.isInteger(i) && i >= 0 && i < beats.length),
    sections: Array.isArray(m.sections)
      ? (m.sections as unknown[]).flatMap((x) => {
          const s = x as { t?: unknown; label?: unknown }
          return typeof s.t === 'number' && Number.isFinite(s.t) && typeof s.label === 'string' ? [{ t: s.t / 1000, label: s.label }] : []
        })
      : [],
  }
  return music.key || music.bpm || beats.length ? music : undefined
}

/** "Key D · 130 BPM · 4/4", leaving out what is not known. */
export function describeMusic(music: SongMusic | undefined): string {
  if (!music) return ''
  return [music.key && `Key ${music.key}`, music.bpm && `${Math.round(music.bpm)} BPM`, music.meter && `${music.meter}/4`].filter(Boolean).join(' · ')
}

/** Key and tempo of a library song, for pages that do not load its stems (Charts). */
export async function fetchSongMusic(base: string, id: string): Promise<SongMusic | undefined> {
  const url = absolute(`${base}/${encodeURIComponent(id)}/stems/manifest.json`)
  return musicOf(((await getJson<unknown>(url)) as SongManifest | null)?.music)
}

/** A download quality of a library song. */
export interface QualityTier {
  id: string
  bytes?: number
}

function tiersOf(raw: unknown): QualityTier[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((t): QualityTier[] => {
    const id = (t as { id?: unknown } | null)?.id
    const bytes = (t as { bytes?: unknown }).bytes
    return typeof id === 'string' && id !== '' ? [{ id, ...(typeof bytes === 'number' && bytes > 0 ? { bytes } : {}) }] : []
  })
}

/** Manifest waveform bytes -> 0..1, or undefined when absent or malformed (the app then decodes it itself). */
function peaksOf(raw: unknown): number[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || raw.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return undefined
  return (raw as number[]).map((v) => Math.min(1, Math.max(0, v / 255)))
}

const absolute = (u: string) => new URL(u, window.location.href)

/**
 * Loads a JSON file of the library (the song list, a manifest). It is saved when it loads, and
 * when there is no network the last saved copy is used, so songs kept on the device still open.
 */
async function getJson<T>(url: URL): Promise<T> {
  let res: Response
  try {
    res = await fetch(url)
  } catch (e) {
    const saved = await audioCache.getJson<T>(url.href).catch(() => undefined)
    if (saved !== undefined) return saved
    throw e
  }
  if (!res.ok) throw new Error(`Failed to load ${url.pathname} (${res.status})`)
  const json = (await res.json()) as T
  void audioCache.putJson(url.href, json).catch(() => {})
  return json
}

const FINGERPRINT = /^[0-9a-f]{8,64}$/

/**
 * The active church's songs. The church is not needed to ask (the session says which), but it is in
 * the address so the copy saved for offline use is per church: switching church while offline never shows the other's list.
 */
export async function fetchLibrary(base: string, churchId: string): Promise<LibrarySong[]> {
  const url = absolute(`${base}/index.json`)
  if (churchId) url.searchParams.set('church', churchId)
  return getJson<LibrarySong[]>(url)
}

/**
 * Loads a library song. `wanted` is the preferred quality; if the song does not offer it, "standard"
 * is used, then whatever comes first. Songs published without tiers have a single quality (`tier` is null).
 */
export async function sourcesFromSong(
  base: string,
  id: string,
  wanted?: string,
): Promise<{ title: string; sources: StemSource[]; tiers: QualityTier[]; tier: string | null; music?: SongMusic }> {
  const manifestUrl = absolute(`${base}/${encodeURIComponent(id)}/stems/manifest.json`)
  const m = checkManifest(await getJson<unknown>(manifestUrl), manifestUrl.pathname)
  const tiers = tiersOf(m.tiers)
  const tier = tiers.length === 0 ? null : (tiers.find((t) => t.id === wanted) ?? tiers.find((t) => t.id === 'standard') ?? tiers[0]).id
  const sources = m.stems.map((s) => {
    const fileName = decodeURIComponent(s.file.split('/').pop()!)
    const url = new URL(tier && tier !== 'original' ? `${tier}/${s.file}` : s.file, manifestUrl)
    // The fingerprint (if the manifest has one for this quality) goes into the address. A changed
    // file gets a new address, so an old copy can never be mistaken for the current one.
    const version = tier && FINGERPRINT.test(s.v?.[tier] ?? '') ? s.v![tier] : undefined
    if (version) url.searchParams.set('v', version)
    return {
      id: s.file,
      name: s.name ?? prettyName(fileName),
      group: s.group ?? '',
      mix: s.mix === true,
      peaks: peaksOf(s.peaks),
      ext: extOf(fileName),
      url: url.href,
      version,
      cacheGroup: `${id}|${tier ?? 'single'}`,
      getBlob: async () => {
        const res = await fetch(url)
        if (!res.ok) throw new Error(`Failed to download ${fileName} (${res.status})`)
        return res.blob()
      },
    }
  })
  return { title: m.title ?? id, sources: sources.sort(sortStems), tiers, tier, music: musicOf(m.music) }
}
