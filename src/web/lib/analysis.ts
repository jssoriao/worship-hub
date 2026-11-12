/**
 * The song analysis for the player (see dev/analysis.ts for where it comes from): chords on the
 * beat grid, sections, and lyrics with a time per word. Times here are seconds.
 */
import { songFile } from './api'
import { keyName, parseKey, prefersFlats, shiftKey, transposeChord } from './chords'

export type ChordLevel = 'basic' | 'simple' | 'complex'

export interface Chord {
  t: number
  end: number
  basic: string
  simple: string
  complex: string
  /** bass note when it is not the root ("" otherwise) */
  bass: string
}
export interface Beat {
  t: number
  /** beat in the bar, 1 starts a bar */
  n: number
}
export interface Word {
  w: string
  t: number
  end: number
}
export interface Line {
  t: number
  end: number
  words: Word[]
}
export interface SongAnalysis {
  key: string
  bpm: number
  beats: Beat[]
  chords: Chord[]
  sections: { t: number; end: number; label: string }[]
  lines: Line[]
}

type Raw = {
  key?: unknown
  bpm?: unknown
  beats?: unknown
  chords?: unknown
  sections?: unknown
  lines?: unknown
}
const arr = (v: unknown): unknown[][] => (Array.isArray(v) ? v.filter((x): x is unknown[] => Array.isArray(x)) : [])
const sec = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v / 1000 : 0)
const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** The song's analysis, or null when it has none (or it cannot be read). */
export async function fetchAnalysis(id: string): Promise<SongAnalysis | null> {
  return getAnalysis(songFile(id, 'analysis.json'))
}

/** An earlier version of the song's analysis (see listVersions in analysis-edit.ts). */
export async function fetchAnalysisVersion(id: string, file: string): Promise<SongAnalysis | null> {
  return getAnalysis(songFile(id, 'analysis', 'history', file))
}

async function getAnalysis(url: string): Promise<SongAnalysis | null> {
  const res = await fetch(url, { cache: 'no-store' }).catch(() => null)
  if (!res?.ok) return null
  const raw = (await res.json().catch(() => null)) as Raw | null
  return raw ? parseAnalysis(raw) : null
}

function parseAnalysis(raw: Raw): SongAnalysis {
  return {
    key: str(raw.key),
    bpm: typeof raw.bpm === 'number' ? raw.bpm : 0,
    beats: arr(raw.beats).map((b) => ({ t: sec(b[0]), n: Number(b[1]) || 1 })),
    chords: arr(raw.chords).map((c) => ({ t: sec(c[0]), end: sec(c[1]), basic: str(c[2]), simple: str(c[3]), complex: str(c[4]), bass: str(c[5]) })),
    sections: arr(raw.sections).map((s) => ({ t: sec(s[0]), end: sec(s[1]), label: str(s[2]) || 'Section' })),
    lines: arr(raw.lines).map((l) => ({
      t: sec(l[0]),
      end: sec(l[1]),
      words: arr(l[2]).map((w) => ({ w: str(w[0]), t: sec(w[1]), end: sec(w[2]) })),
    })),
  }
}

const NO_CHORD = /^(N|N\.C\.?|X)?$/i

/** A chord's name at a detail level, with its bass note (G/B) except at the basic level. "" = no chord. */
export function chordName(c: Chord | undefined, level: ChordLevel): string {
  if (!c) return ''
  const name = c[level] || c.simple || c.basic
  if (NO_CHORD.test(name)) return ''
  if (level === 'basic' || !c.bass) return name
  const root = /^[A-G][#b]?/.exec(name)?.[0]
  return root && root !== c.bass ? `${name}/${c.bass}` : name
}

/** Index of the last item whose `t` is at or before `time` (-1 before the first). Items sorted by t. */
export function indexAt<T extends { t: number }>(items: T[], time: number): number {
  let lo = 0
  let hi = items.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (items[mid].t <= time + 1e-3) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found
}

/** The chord sounding at `time`. */
export function chordAt(a: SongAnalysis, time: number): Chord | undefined {
  const i = indexAt(a.chords, time)
  return i >= 0 && time < a.chords[i].end + 0.05 ? a.chords[i] : undefined
}

/** Bars: the beats grouped from each beat 1 to the next. */
export function barsOf(beats: Beat[]): Beat[][] {
  const bars: Beat[][] = []
  for (const b of beats) {
    if (b.n === 1 || bars.length === 0) bars.push([b])
    else bars[bars.length - 1].push(b)
  }
  return bars
}

/**
 * The chord changes from `time` on, by name at this level (repeats of the same name are one
 * change): the current one first.
 */
export function chordChanges(a: SongAnalysis, level: ChordLevel): { t: number; end: number; name: string }[] {
  const out: { t: number; end: number; name: string }[] = []
  for (const c of a.chords) {
    const name = chordName(c, level)
    if (!name) continue
    const last = out[out.length - 1]
    if (last && last.name === name && c.t - last.end < 0.3) last.end = c.end
    else out.push({ t: c.t, end: c.end, name })
  }
  return out
}

/** The analysis as it reads when the song is played `semitones` higher (or lower): key and chords moved. */
export function transposeAnalysis(a: SongAnalysis, semitones: number): SongAnalysis {
  if (semitones === 0) return a
  const original = parseKey(a.key)
  const target = original ? shiftKey(original, semitones) : null
  const move = (name: string) => (name ? transposeChord(name, semitones, prefersFlats(target, name)) : name)
  return {
    ...a,
    key: target ? keyName(target) : a.key,
    chords: a.chords.map((c) => ({ ...c, basic: move(c.basic), simple: move(c.simple), complex: move(c.complex), bass: move(c.bass) })),
  }
}
