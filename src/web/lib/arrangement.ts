/**
 * Arrangements: a song's sections in your own order, with your own mutes. See docs/arrangements.md.
 */
import type { ClickBeat, TimelineSegment } from './engine'
import type { ChartSection } from './chart'
import type { SongMusic } from './sources'

export interface ArrSection {
  id: string
  label: string
  /** seconds in the recording */
  start: number
  end: number
}

export interface ArrBlock {
  id: string
  section: string
  /** stem ids muted in this block */
  muted: string[]
}

export interface Arrangement {
  id: string
  song: string
  name: string
  owner: string
  updated: string
  sections: ArrSection[]
  blocks: ArrBlock[]
  /** bars of click before the first block */
  countIn: number
}

/** A short random id for URLs and keys. */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_')
}
export const ID = /^[A-Za-z0-9_-]{6,32}$/

/** The downbeat nearest to `t` (seconds), or `t` when the song has no beat grid. */
export function snapToBar(t: number, music: SongMusic | undefined): number {
  const downs = music?.downbeats.map((i) => music.beats[i]) ?? []
  if (downs.length === 0) return t
  return downs.reduce((best, d) => (Math.abs(d - t) < Math.abs(best - t) ? d : best), downs[0])
}

/**
 * Sections to start from: the chart's cued sections (snapped to bars), in the order of their cues,
 * each lasting until the next cue; otherwise the ones suggested from the stems (see dev/sections.ts);
 * otherwise the whole song as one section.
 */
export function sectionsFrom(chartSections: ChartSection[] | null, music: SongMusic | undefined, duration: number): ArrSection[] {
  const fromChart = (chartSections ?? []).some((s) => s.t !== null)
  const marks = fromChart ? (chartSections ?? []) : (music?.sections ?? []).map((s) => ({ label: s.label, t: s.t as number | null }))
  const cued = marks
    .filter((s): s is { label: string; t: number } => s.t !== null && s.t < duration)
    // a cue at the very beginning starts the song (it would otherwise snap to the first bar)
    .map((s) => ({ label: s.label || 'Section', start: s.t < 1 ? 0 : snapToBar(s.t, music) }))
    .sort((a, b) => a.start - b.start)
    // two cues that snap to the same bar: keep the first
    .filter((s, i, all) => i === 0 || s.start > all[i - 1].start + 0.05)
  if (cued.length === 0) return [{ id: newId(), label: 'Whole song', start: 0, end: duration }]
  // anything before the first cue is its own section
  if (cued[0].start > 0.5) cued.unshift({ label: 'Start', start: 0 })
  else cued[0].start = 0
  // the same label twice (two choruses) gets a number, so blocks can tell them apart
  const seen = new Map<string, number>()
  return cued.map((s, i) => {
    const n = (seen.get(s.label) ?? 0) + 1
    seen.set(s.label, n)
    const label = n > 1 ? `${s.label} ${n}` : s.label
    return { id: newId(), label, start: s.start, end: i + 1 < cued.length ? cued[i + 1].start : duration }
  })
}

/** A new arrangement: every section once, in the recording's order. */
export function freshArrangement(song: string, owner: string, sections: ArrSection[]): Arrangement {
  return {
    id: newId(),
    song,
    name: 'My arrangement',
    owner,
    updated: new Date().toISOString(),
    sections,
    blocks: sections.map((s) => ({ id: newId(), section: s.id, muted: [] })),
    countIn: 1,
  }
}

/** Splits the section `id` at `t` (snapped to a bar). Blocks of it become two blocks. */
export function splitSection(arr: Arrangement, id: string, t: number, music: SongMusic | undefined): Arrangement {
  const s = arr.sections.find((x) => x.id === id)
  if (!s) return arr
  const at = snapToBar(t, music)
  if (at <= s.start + 0.5 || at >= s.end - 0.5) return arr
  const second: ArrSection = { id: newId(), label: `${s.label} (b)`, start: at, end: s.end }
  return {
    ...arr,
    sections: arr.sections.flatMap((x) => (x.id === id ? [{ ...x, end: at }, second] : [x])),
    blocks: arr.blocks.flatMap((b) => (b.section === id ? [b, { id: newId(), section: second.id, muted: [...b.muted] }] : [b])),
  }
}

/** Joins section `id` with the one after it in the recording. Blocks of the second one are removed. */
export function joinWithNext(arr: Arrangement, id: string): Arrangement {
  const sorted = [...arr.sections].sort((a, b) => a.start - b.start)
  const i = sorted.findIndex((x) => x.id === id)
  const next = sorted[i + 1]
  if (i < 0 || !next) return arr
  return {
    ...arr,
    sections: arr.sections.filter((x) => x.id !== next.id).map((x) => (x.id === id ? { ...x, end: next.end } : x)),
    blocks: arr.blocks.filter((b) => b.section !== next.id),
  }
}

/** The engine's timeline for an arrangement; `stemIds` in the engine's order. */
export function timelineOf(arr: Arrangement, stemIds: string[]): TimelineSegment[] {
  return arr.blocks.flatMap((b) => {
    const s = arr.sections.find((x) => x.id === b.section)
    if (!s) return []
    const gains = stemIds.map((id) => (b.muted.includes(id) ? 0 : 1))
    return [{ src: s.start, end: s.end, gains }]
  })
}

/** Seconds per beat around `t` in the recording (from the beat grid), or 0.5 (120 BPM). */
export function beatLength(t: number, music: SongMusic | undefined): number {
  const beats = music?.beats ?? []
  const i = beats.findIndex((b) => b >= t)
  if (i > 0 && i < beats.length) return beats[i] - beats[i - 1]
  if (i === 0 && beats.length > 1) return beats[1] - beats[0]
  return music?.bpm ? 60 / music.bpm : 0.5
}

/** Count-in clicks: `bars` bars at the first block's tempo, the first beat of each bar higher. */
export function countIn(arr: Arrangement, music: SongMusic | undefined): { lead: number; beats: ClickBeat[] } {
  const first = arr.sections.find((s) => s.id === arr.blocks[0]?.section)
  if (!first || arr.countIn <= 0) return { lead: 0, beats: [] }
  const beat = beatLength(first.start, music)
  const meter = music?.meter ?? 4
  const n = arr.countIn * meter
  return { lead: n * beat, beats: Array.from({ length: n }, (_, i) => ({ t: i * beat, accent: i % meter === 0 })) }
}

/** Bars in a section (from the beat grid), rounded; null without one. */
export function barsIn(s: ArrSection, music: SongMusic | undefined): number | null {
  if (!music || music.downbeats.length === 0) return null
  const downs = music.downbeats.map((i) => music.beats[i])
  return downs.filter((d) => d >= s.start - 0.05 && d < s.end - 0.05).length
}

/** Checks an arrangement read from storage; null if it is not one. */
export function checkArrangement(raw: unknown): Arrangement | null {
  const a = raw as Partial<Arrangement> | null
  if (!a || typeof a !== 'object' || typeof a.id !== 'string' || !Array.isArray(a.sections) || !Array.isArray(a.blocks)) return null
  const sections = a.sections.filter((s) => s && typeof s.id === 'string' && typeof s.start === 'number' && typeof s.end === 'number')
  const ids = new Set(sections.map((s) => s.id))
  return {
    id: a.id,
    song: typeof a.song === 'string' ? a.song : '',
    name: typeof a.name === 'string' && a.name ? a.name : 'Arrangement',
    owner: typeof a.owner === 'string' ? a.owner : '',
    updated: typeof a.updated === 'string' ? a.updated : '',
    sections: sections.map((s) => ({ id: s.id, label: typeof s.label === 'string' ? s.label : 'Section', start: s.start, end: s.end })),
    blocks: a.blocks
      .filter((b) => b && typeof b.id === 'string' && ids.has(b.section))
      .map((b) => ({ id: b.id, section: b.section, muted: Array.isArray(b.muted) ? b.muted.filter((m) => typeof m === 'string') : [] })),
    countIn: typeof a.countIn === 'number' && a.countIn >= 0 && a.countIn <= 4 ? Math.round(a.countIn) : 1,
  }
}

/** Start times on the timeline of each block, after the count-in. */
export function blockStarts(arr: Arrangement, lead: number): number[] {
  let at = lead
  return arr.blocks.map((b) => {
    const s = arr.sections.find((x) => x.id === b.section)
    const start = at
    at += s ? s.end - s.start : 0
    return start
  })
}

