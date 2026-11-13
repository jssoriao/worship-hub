/**
 * The song's analysis for the player (chords, beats, sections, timed lyrics), made from the raw
 * results of `pnpm songs:analyse` (songs/<song>/analysis/raw/, Music.AI's output as it came).
 * Published to R2 as churches/<churchId>/songs/<songId>/analysis.json. Times are ms.
 *
 *   {
 *     v: 1, key: "D major", bpm: 130,
 *     beats:    [[t, n], ...]                         n = beat in the bar (1 starts a bar)
 *     chords:   [[t, end, basic, simple, complex, bass], ...]   bass "" when none; "N" = no chord
 *     sections: [[t, end, label], ...]
 *     lines:    [[t, end, [[word, t, end, doubt?], ...]], ...]    doubt: the score in percent of a word the
 *                                                                speech-to-text was unsure of (src/shared/doubt.ts)
 *   }
 */
import fs from 'node:fs'
import path from 'node:path'
import { doubtOf } from '../../shared/doubt.ts'

export const ANALYSIS_FILE = 'analysis.json'

export interface Analysis {
  v: 1
  key: string
  bpm: number
  beats: [number, number][]
  chords: [number, number, string, string, string, string][]
  sections: [number, number, string][]
  lines: [number, number, ([string, number, number] | [string, number, number, number])[]][]
}

type StoredWord = Analysis['lines'][number][2][number]
/** The word with its doubt (a score under DOUBT_BELOW, in percent) when it has one. */
const withDoubt = (word: [string, number, number], score: unknown): StoredWord => {
  const d = doubtOf(score)
  return d === null ? word : [...word, d]
}
const ms = (s: unknown) => (typeof s === 'number' && Number.isFinite(s) ? Math.round(s * 1000) : 0)

function read(dir: string, name: string): unknown {
  const file = path.join(dir, name)
  if (!fs.existsSync(file)) return undefined
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    console.warn(`Could not read ${file}; ignoring it.`)
    return undefined
  }
}

/** The analysis of a song, or null when it has not been analysed. */
export function buildAnalysis(songDir: string): Analysis | null {
  const raw = path.join(songDir, 'analysis', 'raw')
  if (!fs.existsSync(raw)) return null
  const chords = read(raw, 'chords.json')
  const beats = read(raw, 'beats.json')
  if (!Array.isArray(chords) || !Array.isArray(beats)) return null
  const sections = read(raw, 'sections.json')
  const lyrics = read(raw, 'lyrics.json')
  const key = read(raw, 'rootKey.json')
  const bpm = Number(read(raw, 'bpm.json'))
  type C = Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  return {
    v: 1,
    key: typeof key === 'string' ? key : '',
    bpm: Number.isFinite(bpm) ? bpm : 0,
    beats: (beats as C[]).filter((b) => typeof b.time === 'number').map((b) => [ms(b.time), Number(b.beatNum) || 1]),
    chords: (chords as C[])
      .filter((c) => typeof c.start === 'number')
      .map((c) => [ms(c.start), ms(c.end), str(c.chord_basic_pop), str(c.chord_simple_pop), str(c.chord_complex_pop), str(c.bass)]),
    sections: Array.isArray(sections)
      ? (sections as C[]).filter((s) => typeof s.start === 'number').map((s) => [ms(s.start), ms(s.end), str(s.label) || 'Section'])
      : [],
    lines: Array.isArray(lyrics)
      ? (lyrics as C[])
          .filter((l) => Array.isArray(l.words))
          .map((l) => [ms(l.start), ms(l.end), (l.words as C[]).map((w) => withDoubt([str(w.word), ms(w.start), ms(w.end)], w.score))])
      : [],
  }
}

/** The analysis as it stands: an edited copy (analysis/analysis.json in the song folder) or the one made from the raw results. */
export function currentAnalysis(songDir: string): Analysis | null {
  const edited = path.join(songDir, 'analysis', ANALYSIS_FILE)
  if (fs.existsSync(edited)) {
    try {
      return JSON.parse(fs.readFileSync(edited, 'utf8')) as Analysis
    } catch {
      console.warn(`Could not read ${edited}; using the raw results.`)
    }
  }
  return buildAnalysis(songDir)
}

/**
 * Adds the doubts of the raw lyrics (Music.AI's lyrics.json) to an analysis that was made before they
 * were kept, or edited since. A word gets its doubt only when it is still what Music.AI heard: the same
 * text starting within 40 ms. A word someone retyped or moved is left alone (a person has been there).
 * Words that already have a doubt keep it. Returns a new analysis and how many words were flagged.
 */
export function addDoubts(current: Analysis, rawLyrics: unknown): { analysis: Analysis; flagged: number } {
  type RawWord = { word?: unknown; start?: unknown; score?: unknown }
  const heard = (Array.isArray(rawLyrics) ? (rawLyrics as { words?: unknown }[]) : [])
    .flatMap((l) => (Array.isArray(l.words) ? (l.words as RawWord[]) : []))
    .filter((w) => typeof w.word === 'string' && typeof w.start === 'number')
    .map((w) => ({ text: w.word as string, t: ms(w.start), doubt: doubtOf(w.score) }))
    .filter((w) => w.doubt !== null)
    .sort((a, b) => a.t - b.t)
  let flagged = 0
  const lines = current.lines.map(([t, end, words]) => [
    t,
    end,
    words.map((w): StoredWord => {
      if (w.length === 4) return w
      const hit = heard.find((h) => Math.abs(h.t - w[1]) <= 40 && h.text === w[0])
      if (!hit) return w
      flagged++
      return [w[0], w[1], w[2], hit.doubt!]
    }),
  ]) as Analysis['lines']
  return { analysis: { ...current, lines }, flagged }
}
