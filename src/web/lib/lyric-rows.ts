/** The rows of the Lyrics view: section headings, rows of chords where nothing is sung, and the sung lines with their chords. */
import { barsOf, chordName, indexAt, type ChordLevel, type SongAnalysis } from './analysis'

export type Token = { w: string; t: number; end: number; chords: string[]; doubt?: boolean }
export type Row = { kind: 'section'; label: string; t: number } | { kind: 'chords'; t: number; chords: string[] } | { kind: 'line'; index: number; t: number; end: number; tokens: Token[] }

const LEAD = 0.25 // a chord this much before a word still belongs to it

/**
 * Builds the sheet: section headings, rows of chords where nothing is sung (intro, instrumentals),
 * and lyric lines with each chord over the word being sung when it starts.
 */
export function buildRows(a: SongAnalysis, level: ChordLevel): Row[] {
  const changes: { t: number; name: string }[] = []
  for (const c of a.chords) {
    const name = chordName(c, level)
    if (!name) continue
    if (changes.length && changes[changes.length - 1].name === name) continue
    changes.push({ t: c.t, name })
  }
  const lines = a.lines.map((l, index) => ({ ...l, index })).filter((l) => l.words.length > 0)
  const rows: Row[] = []
  let ci = 0
  let si = 0
  const sectionsUpTo = (t: number) => {
    while (si < a.sections.length && a.sections[si].t <= t + 0.5) {
      const s = a.sections[si++]
      rows.push({ kind: 'section', label: s.label, t: s.t })
    }
  }
  // the bars (their start times) and how many go on one row of chords
  const barStarts = barsOf(a.beats).map((b) => ({ t: b[0].t }))
  const per = a.barsPerLine ?? 2
  const barOf = (t: number) => indexAt(barStarts, t + LEAD)
  // chords before `t` that are not over a word: rows of `per` bars, counted from the bar the run starts in; a new
  // section starts a new run
  const chordsUntil = (t: number) => {
    let group: string[] = []
    let groupT = 0
    let firstBar = 0
    while (ci < changes.length && changes[ci].t < t - LEAD) {
      const c = changes[ci]
      // a section starting here gets its heading before the chords that follow it
      if (si < a.sections.length && a.sections[si].t <= c.t + 0.5) {
        if (group.length) rows.push({ kind: 'chords', t: groupT, chords: group })
        group = []
        sectionsUpTo(c.t)
      }
      // past this row's bars: the chord starts the next row
      if (group.length && barStarts.length && Math.floor((barOf(c.t) - firstBar) / per) > 0) {
        rows.push({ kind: 'chords', t: groupT, chords: group })
        group = []
      }
      if (group.length === 0) {
        groupT = c.t
        firstBar = barOf(c.t)
      }
      group.push(c.name)
      ci++
    }
    if (group.length) rows.push({ kind: 'chords', t: groupT, chords: group })
  }
  for (const line of lines) {
    chordsUntil(line.t)
    sectionsUpTo(line.t)
    const tokens: Token[] = line.words.map((w) => ({ w: w.w, t: w.t, end: w.end, chords: [], doubt: w.doubt !== undefined }))
    while (ci < changes.length && changes[ci].t < line.end) {
      const c = changes[ci++]
      // the word sounding when the chord starts, or the next one
      let k = tokens.findIndex((tk, i) => c.t < (tokens[i + 1]?.t ?? Infinity) - LEAD && c.t >= tk.t - LEAD)
      if (k < 0) k = c.t < tokens[0].t ? 0 : tokens.length - 1
      tokens[k].chords.push(c.name)
    }
    rows.push({ kind: 'line', index: line.index, t: line.t, end: line.end, tokens })
  }
  chordsUntil(Infinity)
  sectionsUpTo(Infinity)
  return rows
}

