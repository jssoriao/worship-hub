/**
 * Changes to a song's analysis made in the player (chords, sections, lyrics), and saving it.
 * Every function returns a new analysis; nothing is changed in place.
 */
import { SONGS_BASE_URL } from '../config'
import { indexAt, type Chord, type Line, type SongAnalysis } from './analysis'

const EPS = 0.02

/**
 * Sets the chord from beat `t` until the next chord change ("" clears it: no chord). A chord
 * already starting at `t` is replaced; otherwise the chord sounding there is split.
 */
export function setChordAt(a: SongAnalysis, t: number, name: string): SongAnalysis {
  const trimmed = name.trim()
  const [main, bass = ''] = trimmed.split('/')
  const make = (from: number, end: number): Chord => ({ t: from, end, basic: main || 'N', simple: main || 'N', complex: main || 'N', bass: bass })
  const chords = [...a.chords]
  const i = indexAt(chords, t)
  const c = i >= 0 ? chords[i] : undefined
  if (c && Math.abs(c.t - t) < EPS) {
    chords[i] = make(c.t, c.end)
  } else if (c && t < c.end) {
    chords.splice(i, 1, { ...c, end: t }, make(t, c.end))
  } else {
    // between chords, or before the first: until the next chord starts
    const next = chords[i + 1]
    chords.splice(i + 1, 0, make(t, next ? next.t : t + 2))
  }
  return { ...a, chords }
}

/** Starts a section called `label` at `t` (on a bar), or renames the one starting there. */
export function setSectionAt(a: SongAnalysis, t: number, label: string): SongAnalysis {
  const name = label.trim() || 'Section'
  const sections = [...a.sections]
  const i = indexAt(sections, t)
  if (i >= 0 && Math.abs(sections[i].t - t) < 0.3) {
    sections[i] = { ...sections[i], label: name }
  } else {
    const end = sections[i + 1]?.t ?? (sections[i]?.end ?? t + 10)
    if (i >= 0) sections[i] = { ...sections[i], end: t }
    sections.splice(i + 1, 0, { t, end, label: name })
  }
  return { ...a, sections }
}

/** Removes the section starting at `t`; the one before it then lasts until the next. */
export function removeSectionAt(a: SongAnalysis, t: number): SongAnalysis {
  const i = a.sections.findIndex((s) => Math.abs(s.t - t) < 0.3)
  if (i < 0) return a
  const sections = [...a.sections]
  const [gone] = sections.splice(i, 1)
  if (i > 0) sections[i - 1] = { ...sections[i - 1], end: gone.end }
  return { ...a, sections }
}

/** A word compared without case or punctuation, so "you," matches "You". */
const plain = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')

/**
 * Pairs old words with new ones (a longest common subsequence of their plain forms) and returns,
 * for each new word, the old words it takes its time from: [from, to) or null when it is new.
 */
function matchWords(old: string[], next: string[]): ([number, number] | null)[] {
  const a = old.map(plain)
  const b = next.map(plain)
  // lcs[i][j]: the longest match of a[i..] and b[j..]
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
  // walk it: equal words pair up; between two pairs the changed words share the old ones in order
  const out: ([number, number] | null)[] = new Array(b.length).fill(null)
  const fill = (a0: number, a1: number, b0: number, b1: number) => {
    const n = b1 - b0
    const m = a1 - a0
    if (n === 0 || m === 0) return
    for (let k = 0; k < n; k++) {
      const lo = a0 + Math.floor((k * m) / n)
      const hi = Math.max(lo + 1, a0 + Math.floor(((k + 1) * m) / n))
      out[b0 + k] = [lo, hi]
    }
  }
  let i = 0
  let j = 0
  let ai = 0
  let bj = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      fill(ai, i, bj, j)
      out[j] = [i, i + 1]
      i++
      j++
      ai = i
      bj = j
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++
    else j++
  }
  fill(ai, a.length, bj, b.length)
  return out
}

/**
 * Replaces the words of line `index` with `text`, keeping the song's timing: an unchanged word
 * keeps its exact time, a changed word takes the time of the word(s) it replaces, and an added
 * word sits right after the word before it. The line's start and end follow its words.
 */
export function setLineText(a: SongAnalysis, index: number, text: string): SongAnalysis {
  const line = a.lines[index]
  if (!line) return a
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return deleteLine(a, index)
  const pairs = matchWords(
    line.words.map((w) => w.w),
    words,
  )
  const timed = words.map((w, k) => {
    const p = pairs[k]
    return p ? { w, t: line.words[p[0]].t, end: line.words[p[1] - 1].end } : { w, t: NaN, end: NaN }
  })
  // added words: at the end of the word before (or the start of the one after)
  timed.forEach((word, k) => {
    if (!Number.isNaN(word.t)) return
    const before = timed.slice(0, k).reverse().find((x) => !Number.isNaN(x.t))
    const after = timed.slice(k + 1).find((x) => !Number.isNaN(x.t))
    const at = before ? before.end : after ? after.t : line.t
    word.t = at
    word.end = at
  })
  const next: Line = { t: timed[0].t, end: timed[timed.length - 1].end, words: timed }
  const lines = [...a.lines]
  lines[index] = next
  return { ...a, lines }
}

export function deleteLine(a: SongAnalysis, index: number): SongAnalysis {
  return { ...a, lines: a.lines.filter((_, i) => i !== index) }
}

/** Splits line `index` before word `at`, so the rest starts a new line. */
export function splitLine(a: SongAnalysis, index: number, at: number): SongAnalysis {
  const line = a.lines[index]
  if (!line || at <= 0 || at >= line.words.length) return a
  const first = line.words.slice(0, at)
  const rest = line.words.slice(at)
  const lines = [...a.lines]
  lines.splice(index, 1, { t: line.t, end: first[first.length - 1].end, words: first }, { t: rest[0].t, end: line.end, words: rest })
  return { ...a, lines }
}

/** Joins line `index` with the one after it. */
export function joinWithNextLine(a: SongAnalysis, index: number): SongAnalysis {
  const line = a.lines[index]
  const next = a.lines[index + 1]
  if (!line || !next) return a
  const lines = [...a.lines]
  lines.splice(index, 2, { t: line.t, end: next.end, words: [...line.words, ...next.words] })
  return { ...a, lines }
}

const ms = (s: number) => Math.round(s * 1000)

/** The stored form (see dev/analysis.ts): times in ms, rows as arrays. */
export function toStored(a: SongAnalysis) {
  return {
    v: 1 as const,
    key: a.key,
    bpm: a.bpm,
    beats: a.beats.map((b) => [ms(b.t), b.n]),
    chords: a.chords.map((c) => [ms(c.t), ms(c.end), c.basic, c.simple, c.complex, c.bass]),
    sections: a.sections.map((s) => [ms(s.t), ms(s.end), s.label]),
    lines: a.lines.map((l) => [ms(l.t), ms(l.end), l.words.map((w) => [w.w, ms(w.t), ms(w.end)])]),
  }
}

export async function saveAnalysis(id: string, a: SongAnalysis): Promise<void> {
  const res = await fetch(`${SONGS_BASE_URL}/${encodeURIComponent(id)}/analysis.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toStored(a)),
  })
  if (!res.ok) throw new Error(res.status === 403 ? 'only admins can edit' : (await res.text().catch(() => '')) || `HTTP ${res.status}`)
}

export interface AnalysisVersion {
  file: string
  savedAt: string
  savedBy: string
}

export async function listVersions(id: string): Promise<AnalysisVersion[]> {
  const res = await fetch(`${SONGS_BASE_URL}/${encodeURIComponent(id)}/analysis/history/`, { cache: 'no-store' })
  if (!res.ok) return []
  const list = (await res.json().catch(() => [])) as AnalysisVersion[]
  return Array.isArray(list) ? list : []
}
