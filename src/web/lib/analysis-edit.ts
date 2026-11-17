/**
 * Changes to a song's analysis made in the player (chords, sections, lyrics), and saving it.
 * Every function returns a new analysis; nothing is changed in place.
 */
import { indexAt, type Chord, type Line, type SongAnalysis, type Word } from './analysis'
import { call, songsApi } from './api'

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
    // where nothing sounds (between chords, before the first, after the last): until the next chord, or the song's end
    const next = chords[i + 1]
    chords.splice(i + 1, 0, make(t, next ? next.t : songEnd(a, t)))
  }
  return { ...a, chords }
}

/** Where the song ends, as far as the analysis knows (its last beat, section, line or chord), and never before `t`. */
function songEnd(a: SongAnalysis, t: number): number {
  const beats = a.beats
  const lastBeat = beats.length > 0 ? beats[beats.length - 1].t + (beats.length > 1 ? beats[beats.length - 1].t - beats[beats.length - 2].t : 0.5) : 0
  const ends = [lastBeat, ...a.sections.map((s) => s.end), ...a.lines.map((l) => l.end), ...a.chords.map((c) => c.end)]
  return Math.max(t + 0.5, ...ends)
}
/**
 * Takes away the chord that starts at `t`: the chord before it carries on until the next change.
 * Does nothing when no chord starts there.
 */
export function removeChordAt(a: SongAnalysis, t: number): SongAnalysis {
  const i = a.chords.findIndex((c) => Math.abs(c.t - t) < EPS)
  if (i < 0) return a
  const chords = [...a.chords]
  const [gone] = chords.splice(i, 1)
  if (i > 0 && Math.abs(chords[i - 1].end - gone.t) < 0.05) chords[i - 1] = { ...chords[i - 1], end: gone.end }
  return { ...a, chords }
}
/** A time as a (fractional) beat number on the song's beat grid. */
function beatPos(beats: { t: number }[], t: number): number {
  const i = indexAt(beats, t)
  if (i < 0) return 0
  const step = beats[i + 1] ? beats[i + 1].t - beats[i].t : i > 0 ? beats[i].t - beats[i - 1].t : 0.5
  return i + (t - beats[i].t) / (step || 0.5)
}
/** The time of a (fractional) beat number. */
function beatTime(beats: { t: number }[], pos: number): number {
  const i = Math.min(Math.max(Math.floor(pos), 0), beats.length - 1)
  const step = beats[i + 1] ? beats[i + 1].t - beats[i].t : i > 0 ? beats[i].t - beats[i - 1].t : 0.5
  return beats[i].t + (pos - i) * step
}
/** The chords outside [from, to), cut at its edges, plus `added` (which fill it), in order. */
function replaceChords(chords: Chord[], from: number, to: number, added: Chord[]): Chord[] {
  const kept: Chord[] = []
  for (const c of chords) {
    if (c.end <= from + EPS || c.t >= to - EPS) kept.push(c)
    else {
      if (c.t < from - EPS) kept.push({ ...c, end: from })
      if (c.end > to + EPS) kept.push({ ...c, t: to })
    }
  }
  return [...kept, ...added].sort((x, y) => x.t - y.t)
}
/**
 * Copies the chords of section `from` onto section `to` (indexes in `a.sections`), bar for bar:
 * the beat grid carries them, so a different tempo or a longer bar still lines up. Only as much
 * of `to` as `from` is long is replaced, and chords are cut where the copy would pass its end.
 */
export function copySectionChords(a: SongAnalysis, from: number, to: number): SongAnalysis {
  const src = a.sections[from]
  const dst = a.sections[to]
  if (!src || !dst || from === to || a.beats.length === 0) return a
  const p0 = beatPos(a.beats, src.t)
  const p1 = beatPos(a.beats, src.end)
  const q0 = beatPos(a.beats, dst.t)
  const q1 = Math.min(q0 + (p1 - p0), beatPos(a.beats, dst.end))
  const end = beatTime(a.beats, q1)
  const start = beatTime(a.beats, q0)
  const added: Chord[] = []
  for (const c of a.chords) {
    if (c.end <= src.t + EPS || c.t >= src.end - EPS) continue
    const t = beatTime(a.beats, q0 + Math.max(beatPos(a.beats, c.t) - p0, 0))
    const e = Math.min(beatTime(a.beats, q0 + Math.min(beatPos(a.beats, c.end), p1) - p0), end)
    if (t >= end - EPS) continue
    added.push({ ...c, t: Math.max(t, start), end: e })
  }
  return { ...a, chords: replaceChords(a.chords, start, end, added) }
}
/** The lyric lines of section `k` (indexes in `a.lines`): those starting in it, as the lyrics view groups them. */
export function sectionLines(a: SongAnalysis, k: number): number[] {
  const start = a.sections[k]?.t
  if (start === undefined) return []
  const next = a.sections[k + 1]?.t ?? Infinity
  return a.lines.flatMap((l, i) => (l.words.length > 0 && l.t + 0.5 >= start && l.t + 0.5 < next ? [i] : []))
}
/**
 * Copies the words of section `from` onto section `to`, line for line. Only when both have the same
 * number of lines. Each line keeps its own place in the song (its start and end follow its words, as in
 * setLineText); words that differ share the times of the words they replace, so only the highlighting
 * inside a line is approximate.
 */
export function copySectionLyrics(a: SongAnalysis, from: number, to: number): SongAnalysis {
  const src = sectionLines(a, from)
  const dst = sectionLines(a, to)
  if (from === to || src.length === 0 || src.length !== dst.length) return a
  return dst.reduce((acc, line, k) => setLineText(acc, line, a.lines[src[k]].words.map((w) => w.w).join(' ')), a)
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
 * word sits right after the word before it. The line's start and end follow its words. Retyping a
 * line also checks it: none of its words are flagged as doubtful any more.
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

/** The beat nearest to `t`, or `t` itself when the song has no beats. */
export function snapToBeat(a: SongAnalysis, t: number): number {
  const beats = a.beats
  if (beats.length === 0) return t
  const i = indexAt(beats, t)
  const lo = beats[Math.max(i, 0)]
  const hi = beats[Math.min(i + 1, beats.length - 1)]
  return Math.abs(t - lo.t) <= Math.abs(hi.t - t) ? lo.t : hi.t
}
/** Where a line starting at `t` ends when nothing says: two bars later (the second bar line after it). */
function twoBarsAfter(a: SongAnalysis, t: number): number {
  let bars = 0
  for (const b of a.beats) {
    if (b.t > t + 0.05 && b.n === 1 && ++bars === 2) return b.t
  }
  return t + 2 * 4 * (60 / (a.bpm > 0 ? a.bpm : 100))
}
/** A sung word takes about this long: the first guess for how far a line's words reach (it is then fixed by ear). */
const WORD_SECONDS = 0.6
/**
 * Words spread over a line from `t`: each takes a share of the time by its length, up to `end`. Without `exact` the
 * words reach no further than a guess from their count; with it (the end was held) they fill the time to `end`.
 */
function spreadWords(words: string[], t: number, end: number, exact = false): Word[] {
  const reach = exact ? end - t : Math.min(Math.max(end - t, 0.5), Math.max(words.length * WORD_SECONDS, 1))
  const weight = words.map((w) => Math.max(1, w.replace(/[^\p{L}\p{N}]/gu, '').length))
  const total = weight.reduce((x, y) => x + y, 0)
  let used = 0
  return words.map((w, k) => {
    const from = t + (reach * used) / total
    used += weight[k]
    return { w, t: from, end: t + (reach * used) / total }
  })
}
/**
 * Adds lyric lines at the given moments (snapped to the nearest beat), each running until the next one starts
 * (the last: two bars, or until a line that is already there), or until its `end` when one is given (a held tap;
 * not snapped, never past the next line). The words of a line are spread over its time by length, a first guess
 * to fix by ear. Existing lines stay; empty text is skipped.
 */
export function addLines(a: SongAnalysis, items: { t: number; end?: number; text: string }[]): SongAnalysis {
  const wanted = items
    .map((x) => ({ t: snapToBeat(a, Math.max(0, x.t)), held: x.end, words: x.text.trim().split(/\s+/).filter(Boolean) }))
    .filter((x) => x.words.length > 0)
    .sort((x, y) => x.t - y.t)
  // two lines on the same beat would fall on each other: the later one moves a hair after
  wanted.forEach((x, k) => {
    if (k > 0 && x.t <= wanted[k - 1].t + 0.01) x.t = wanted[k - 1].t + 0.05
  })
  const added: Line[] = wanted.map((x, k) => {
    const nextOld = a.lines.find((l) => l.t > x.t + 0.01)?.t
    const next = k + 1 < wanted.length ? wanted[k + 1].t : Math.min(twoBarsAfter(a, x.t), nextOld ?? Infinity)
    if (x.held !== undefined && x.held > x.t + 0.05) {
      const words = spreadWords(x.words, x.t, Math.min(x.held, next), true)
      return { t: x.t, end: words[words.length - 1].end, words }
    }
    const words = spreadWords(x.words, x.t, Math.max(next, x.t + 0.5))
    return { t: x.t, end: words[words.length - 1].end, words }
  })
  if (added.length === 0) return a
  return { ...a, lines: [...a.lines, ...added].sort((x, y) => x.t - y.t) }
}
/** Adds one lyric line at `t` (see addLines). */
export const addLine = (a: SongAnalysis, t: number, text: string): SongAnalysis => addLines(a, [{ t, text }])
/** A word whose length is not known (it was added while retyping) is taken to last this long, at most until the next. */
const TAPPED_WORD_SECONDS = 0.5
/**
 * Sets when the words of line `index` start, one tap per word in order (`taps[k]` for word k, in seconds). A tapped
 * word keeps its own length but never runs into the next word; a held tap (`end`) sets where the word ends instead. When only the first words were tapped, the rest keep
 * their spacing and move by as much as the last tapped word did (never starting before it). The line's start and end
 * follow its words; the words and their doubts are untouched.
 */
export function retimeWords(a: SongAnalysis, index: number, taps: { t: number; end?: number }[]): SongAnalysis {
  const line = a.lines[index]
  if (!line || taps.length === 0) return a
  const n = Math.min(taps.length, line.words.length)
  const tapped = taps.slice(0, n).map((x) => Math.max(0, x.t))
  // a tap a hair before the one before it (a double tap) counts as the same moment
  for (let k = 1; k < n; k++) tapped[k] = Math.max(tapped[k], tapped[k - 1])
  const moved = tapped[n - 1] - line.words[n - 1].t
  const t = line.words.map((w, k) => (k < n ? tapped[k] : Math.max(w.t + moved, tapped[n - 1])))
  const words = line.words.map((w, k) => {
    const held = k < n ? taps[k].end : undefined
    const own = w.end - w.t > 0.01 ? w.end - w.t : TAPPED_WORD_SECONDS
    const next = k + 1 < t.length ? t[k + 1] : Infinity
    return { ...w, t: t[k], end: Math.max(t[k], Math.min(held ?? t[k] + own, next)) }
  })
  const lines = [...a.lines]
  lines[index] = { t: words[0].t, end: Math.max(...words.map((w) => w.end)), words }
  return { ...a, lines }
}
/** Whether a line has a word the speech-to-text was unsure of (and nobody has checked yet). */
export const hasDoubt = (line: Line) => line.words.some((w) => w.doubt !== undefined)

/** How many lines are waiting to be checked. */
export const doubtfulLines = (a: SongAnalysis) => a.lines.filter(hasDoubt).length

/** Marks line `index` as checked: its words are trusted as they are. */
export function approveLine(a: SongAnalysis, index: number): SongAnalysis {
  const line = a.lines[index]
  if (!line || !hasDoubt(line)) return a
  const lines = [...a.lines]
  lines[index] = { ...line, words: line.words.map(({ doubt: _doubt, ...word }) => word) }
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
    lines: a.lines.map((l) => [ms(l.t), ms(l.end), l.words.map((w) => (w.doubt === undefined ? [w.w, ms(w.t), ms(w.end)] : [w.w, ms(w.t), ms(w.end), Math.round(w.doubt * 100)]))]),
    ...(a.barsPerLine ? { barsPerLine: a.barsPerLine } : {}),
  }
}

export async function saveAnalysis(id: string, a: SongAnalysis): Promise<void> {
  await call(songsApi[':songId']['analysis.json'].$put({ param: { songId: id }, json: toStored(a) }), { 403: 'only editors can edit' })
}
export const listVersionsOf = (id: string) => call(songsApi[':songId'].analysis.history.$get({ param: { songId: id } }))
export type AnalysisVersion = Awaited<ReturnType<typeof listVersionsOf>>[number]
/** Earlier versions of the song's analysis, newest first; none when they cannot be loaded. */
export const listVersions = (id: string): Promise<AnalysisVersion[]> => listVersionsOf(id).catch(() => [])

/** The lyrics as text: one line per row, a blank row where a new section starts. */
export function lyricsText(a: SongAnalysis): string {
  const starts = a.sections.map((s) => s.t)
  return a.lines
    .map((l, k) => {
      const text = l.words.map((w) => w.w).join(' ')
      // a section starting between the line before and this one
      const fresh = k > 0 && starts.some((t) => t > a.lines[k - 1].t + EPS && t <= l.t + EPS)
      return fresh ? `\n${text}` : text
    })
    .join('\n')
}
/** A line's words as one comparable string (no case, no punctuation, no spaces). */
const plainLine = (text: string) => text.split(/\s+/).map(plain).join('')
/**
 * Replaces all the lyrics with `text` (one line per row; blank rows are ignored), keeping as much timing as it can:
 * an unchanged line keeps its exact times; changed lines take the time of the line(s) they replace, shared out in
 * order; added lines share the gap between their neighbours. The times of changed and added lines are a guess, to
 * fix with Tap. Doubts are kept only on unchanged lines.
 */
export function setAllLyrics(a: SongAnalysis, text: string): SongAnalysis {
  const rows = text.split('\n').map((r) => r.trim().split(/\s+/).filter(Boolean)).filter((r) => r.length > 0)
  const old = a.lines
  const pairs = matchWords(
    old.map((l) => l.words.map((w) => w.w).join(' ')),
    rows.map((r) => r.join(' ')),
  )
  // each new row: the old line it is (unchanged), or the time it may use (null: none, an added row)
  type Slot = { keep: Line } | { lo: number; hi: number } | null
  const slots: Slot[] = rows.map((r, j) => {
    const p = pairs[j]
    if (!p) return null
    if (p[1] - p[0] === 1 && plainLine(r.join(' ')) === plainLine(old[p[0]].words.map((w) => w.w).join(' '))) return { keep: old[p[0]] }
    return { lo: p[0], hi: p[1] }
  })
  const out: (Line | null)[] = rows.map(() => null)
  // unchanged rows first; then rows sharing one old time span split it in order
  slots.forEach((s, j) => {
    if (s && 'keep' in s) out[j] = s.keep
  })
  for (let j = 0; j < rows.length; ) {
    const s = slots[j]
    if (!s || 'keep' in s) {
      j++
      continue
    }
    let k = j
    while (k + 1 < rows.length) {
      const n = slots[k + 1]
      if (!n || 'keep' in n || n.lo !== s.lo || n.hi !== s.hi) break
      k++
    }
    const from = old[s.lo].t
    const to = Math.max(old[s.hi - 1].end, from + 0.5)
    const share = (to - from) / (k - j + 1)
    for (let m = j; m <= k; m++) {
      const t = from + share * (m - j)
      out[m] = { t, end: t + share, words: spreadWords(rows[m], t, t + share, true) }
    }
    j = k + 1
  }
  // added rows: the gap between the line before and the line after
  for (let j = 0; j < rows.length; ) {
    if (out[j]) {
      j++
      continue
    }
    let k = j
    while (k + 1 < rows.length && !out[k + 1]) k++
    const before = j > 0 ? out[j - 1]!.end : 0
    const after = k + 1 < rows.length ? out[k + 1]!.t : Infinity
    const count = k - j + 1
    const share = Number.isFinite(after) ? Math.max(after - before, 0.05 * count) / count : 2
    for (let m = j; m <= k; m++) {
      const t = before + share * (m - j)
      out[m] = { t, end: t + share, words: spreadWords(rows[m], t, t + share, true) }
    }
    j = k + 1
  }
  // keep them in order (a row never starts before the one above it)
  const lines = out as Line[]
  for (let j = 1; j < lines.length; j++) {
    if (lines[j].t < lines[j - 1].t + 0.01) {
      const by = lines[j - 1].t + 0.01 - lines[j].t
      lines[j] = { t: lines[j].t + by, end: lines[j].end + by, words: lines[j].words.map((w) => ({ ...w, t: w.t + by, end: w.end + by })) }
    }
  }
  return { ...a, lines }
}

/**
 * Sets where lines start, one tap per line from line `from` on (`taps[k]` for line from + k), each snapped to the
 * nearest beat. A line keeps the shape of its words (their spacing) and is squeezed only when it would run into the
 * next line; a held tap (`end`) stretches or squeezes its words to end there. When the last tapped line moved later
 * past the lines after it, those move along by as much (keeping their spacing).
 */
export function retimeLines(a: SongAnalysis, from: number, taps: { t: number; end?: number }[]): SongAnalysis {
  const n = Math.min(taps.length, a.lines.length - from)
  if (n <= 0) return a
  const lines = [...a.lines]
  const starts = taps.slice(0, n).map((x) => snapToBeat(a, Math.max(0, x.t)))
  for (let k = 1; k < n; k++) starts[k] = Math.max(starts[k], starts[k - 1] + 0.05)
  const own = (line: Line) => (line.end - line.t > 0.01 ? line.end - line.t : Math.max(0.5, line.words.length * WORD_SECONDS))
  // the lines after move along when the last tapped line moved later and now runs into them
  const lastOld = a.lines[from + n - 1]
  const by = starts[n - 1] - lastOld.t
  const after = a.lines[from + n]
  const shift = by > 0 && after !== undefined && after.t < starts[n - 1] + own(lastOld) ? by : 0
  for (let k = 0; k < n; k++) {
    const line = a.lines[from + k]
    const t = starts[k]
    const next = k + 1 < n ? starts[k + 1] : after ? after.t + shift : Infinity
    const span0 = own(line)
    const held = taps[k].end
    const span = held !== undefined && held > t + 0.05 ? Math.min(held, next) - t : Math.min(span0, Math.max(next - t, 0.05))
    const scale = span / span0
    const words = line.words.map((w) => ({ ...w, t: t + Math.max(0, w.t - line.t) * scale, end: t + Math.max(0, w.end - line.t) * scale }))
    lines[from + k] = { t, end: Math.max(t, ...words.map((w) => w.end)), words }
  }
  if (shift > 0) {
    for (let j = from + n; j < lines.length; j++) {
      const l = lines[j]
      lines[j] = { t: l.t + shift, end: l.end + shift, words: l.words.map((w) => ({ ...w, t: w.t + shift, end: w.end + shift })) }
    }
  }
  return { ...a, lines }
}
