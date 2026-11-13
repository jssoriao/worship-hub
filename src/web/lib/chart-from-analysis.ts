/**
 * A first ChordPro chart from a song's analysis: its sections, lyrics and chords. It is built once,
 * when an editor asks for it; after that the chart is its own text, edited on its own (rebuilding
 * replaces it). See chart.ts for the format.
 *
 *   {start_of_verse: Verse}
 *   {cue: 0:12.5}
 *   [D]Words of the [G]line
 *   {end_of_verse}
 *
 * - A chord goes in front of the word sung when it changes (a long word is split where it changes).
 * - A line starts with the chord already playing only when it is not the last chord written (and in
 *   a section's first line), so a chord held across lines is written once.
 * - Quick chords (shorter than about a beat and a half) are left out unless asked for.
 * - Chords between sung lines become chord-only lines, a few per line.
 * - Every section gets a `{cue}` from where it starts, so the chart follows the stems.
 * - Chords are spelled for the key (G# becomes Ab in a song in Ab).
 * - Sections stay in the order of the recording, repeats written out.
 */
import { chordChanges, type ChordLevel, type SongAnalysis, type Word } from './analysis'
import { keyName, parseKey, prefersFlats, respellChord } from './chords'

export interface BuildOptions {
  title?: string
  artist?: string
  /** how much of each chord to write: "basic" (triads), "simple" or "complex" */
  level?: ChordLevel
  /** lines with more words are split at their longest pause */
  maxWords?: number
  /** keep chords shorter than about a beat and a half (passing chords); left out by default */
  quickChords?: boolean
}

/** a chord this much before a word (in seconds) is played for that word */
const LEAD = 0.25
/** chords per chord-only line */
const PER_LINE = 4
/** a chord lasting less than this many beats is a quick (passing) chord */
const QUICK_BEATS = 1.5

type Change = { t: number; name: string }
type Section = { t: number; label: string }

export function chartFromAnalysis(a: SongAnalysis, opts: BuildOptions = {}): string {
  const level = opts.level ?? 'simple'
  const maxWords = Math.max(4, opts.maxWords ?? 10)
  const key = parseKey(a.key)
  const spell = (name: string) => (key ? respellChord(name, prefersFlats(key)) : name)

  const spelled: Change[] = []
  for (const c of chordChanges(a, level)) {
    const name = spell(c.name)
    if (spelled[spelled.length - 1]?.name !== name) spelled.push({ t: c.t, name })
  }
  const changes = opts.quickChords ? spelled : withoutQuick(spelled, (QUICK_BEATS * 60) / (a.bpm > 0 ? a.bpm : 100))
  const lines = a.lines
    .map((l) => l.words.map((w) => ({ ...w, w: clean(w.w) })).filter((w) => w.w !== ''))
    .filter((words) => words.length > 0)
    .flatMap((words) => split(words, maxWords))
    .sort((x, y) => x[0].t - y[0].t)
  const sections: Section[] = [...a.sections].sort((x, y) => x.t - y.t)
  if (sections.length === 0) sections.push({ t: 0, label: 'Song' })

  const out: string[] = []
  if (opts.title?.trim()) out.push(`{title: ${oneLine(opts.title)}}`)
  if (opts.artist?.trim()) out.push(`{artist: ${oneLine(opts.artist)}}`)
  const keyText = key ? keyName(key) : a.key.trim()
  if (keyText) out.push(`{key: ${keyText}}`)

  // each line and chord belongs to the last section starting at or before it (the first one gets
  // what comes before it); a chord counts from slightly earlier, as it is played for the next word
  const sectionOf = (t: number) => {
    let i = 0
    while (i + 1 < sections.length && sections[i + 1].t <= t + 1e-3) i++
    return i
  }
  let ci = 0
  let li = 0
  sections.forEach((section, si) => {
    const sectionLines: Word[][] = []
    while (li < lines.length && sectionOf(lines[li][0].t) <= si) sectionLines.push(lines[li++])
    const sectionChords: Change[] = []
    while (ci < changes.length && sectionOf(changes[ci].t + LEAD) <= si) sectionChords.push(changes[ci++])

    const body = sectionBody(sectionLines, sectionChords, (t) => changes[lastAt(changes, t + 0.05)]?.name ?? '')
    const kind = blockKind(section.label, sectionLines.length > 0)
    if (out.length > 0) out.push('')
    out.push(kind ? `{start_of_${kind}: ${oneLine(section.label)}}` : `{comment: ${oneLine(section.label)}}`)
    out.push(`{cue: ${cueTime(section.t)}}`)
    out.push(...body)
    if (kind) out.push(`{end_of_${kind}}`)
  })
  return out.join('\n') + '\n'
}

/** A section's lines: chord-only lines for what is played between sung lines, then each sung line. */
function sectionBody(lines: Word[][], chords: Change[], sounding: (t: number) => string): string[] {
  const out: string[] = []
  const chordLines = (names: string[]) => {
    for (let i = 0; i < names.length; i += PER_LINE) out.push(names.slice(i, i + PER_LINE).map((n) => `[${n}]`).join(' '))
  }
  let ci = 0
  // the last chord written in this section ("" before the first)
  let last = ''
  for (const words of lines) {
    const start = words[0].t
    const end = words[words.length - 1].end
    const gap: string[] = []
    while (ci < chords.length && chords[ci].t + LEAD < start) gap.push(chords[ci++].name)
    // a lone chord before the line is the one it starts on, and is written on its first word
    if (gap.length > 1 || (gap.length === 1 && gap[0] !== sounding(start))) {
      chordLines(gap)
      last = gap[gap.length - 1]
    }
    const mine: Change[] = []
    while (ci < chords.length && chords[ci].t < end) mine.push(chords[ci++])
    const playing = sounding(start)
    const restate = playing !== last ? playing : ''
    out.push(sungLine(words, mine, restate))
    last = mine.length > 0 ? mine[mine.length - 1].name : restate || last
  }
  chordLines(chords.slice(ci).map((c) => c.name))
  return out
}

/**
 * Leaves out chords shorter than `min` seconds (to the next change); the chord before one goes on
 * through it, and joins the next when that is the same chord (A, quick G, A -> A).
 */
function withoutQuick(changes: Change[], min: number): Change[] {
  const out: Change[] = []
  changes.forEach((c, i) => {
    const next = changes[i + 1]
    if (next && next.t - c.t < min) return
    if (out[out.length - 1]?.name !== c.name) out.push(c)
  })
  return out
}

/** "[D]Words of the [G]line". `sounding` (the chord playing, when it needs writing) goes on the first word when no change falls there. */
function sungLine(words: Word[], chords: Change[], sounding: string): string {
  const at = words.map((): Change[] => [])
  for (const c of chords) at[wordFor(words, c.t)].push(c)
  if (at[0].length === 0 && sounding) at[0].push({ t: words[0].t, name: sounding })
  return words
    .map((w, i) => {
      const [first, ...more] = at[i]
      const text = w.w
      // later changes inside a held word go where they fall in it (or after a one-letter word)
      let out = ''
      let from = 0
      for (const c of more) {
        const share = w.end > w.t ? (c.t - w.t) / (w.end - w.t) : 1
        const pos = text.length < 2 ? text.length : Math.min(text.length - 1, Math.max(from || 1, Math.round(share * text.length)))
        out += `${text.slice(from, pos)}[${c.name}]`
        from = pos
      }
      return (first ? `[${first.name}]` : '') + out + text.slice(from)
    })
    .join(' ')
}

/** The word a chord change is played on: the one starting nearest to it, at most LEAD after it (the first word for a change at or before the line starts). */
function wordFor(words: Word[], t: number): number {
  if (t <= words[0].t + 0.05) return 0
  const j = Math.max(0, lastAt(words, t + LEAD))
  return j > 0 && Math.abs(words[j - 1].t - t) < Math.abs(words[j].t - t) ? j - 1 : j
}

/** Splits a long line at its longest pause, keeping at least 3 words on each side, until every part fits. */
function split(words: Word[], max: number): Word[][] {
  if (words.length <= max) return [words]
  let best = 3
  let bestGap = -Infinity
  for (let i = 3; i <= words.length - 3; i++) {
    // pauses near the middle win ties, so the halves come out even
    const gap = words[i].t - words[i - 1].end - Math.abs(i - words.length / 2) * 1e-3
    if (gap > bestGap) {
      bestGap = gap
      best = i
    }
  }
  return [...split(words.slice(0, best), max), ...split(words.slice(best), max)]
}

/** ChordPro block for a section label; null for an instrumental part, written as a comment. */
function blockKind(label: string, sung: boolean): string | null {
  if (/^pre/i.test(label)) return 'verse'
  if (/chorus/i.test(label)) return 'chorus'
  if (/bridge/i.test(label)) return 'bridge'
  if (/verse/i.test(label)) return 'verse'
  return sung ? 'verse' : null
}

/** Index of the last item starting at or before `t` (-1 before the first). */
function lastAt<T extends { t: number }>(items: T[], t: number): number {
  let i = -1
  while (i + 1 < items.length && items[i + 1].t <= t + 1e-3) i++
  return i
}

/** "1:05.3", as "Mark cue" writes it. */
function cueTime(t: number): string {
  const s = Math.max(0, Math.round(t * 10) / 10)
  const m = Math.floor(s / 60)
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`
}

/** Brackets and braces would be read as chords or directives. */
const clean = (w: string) => w.replace(/[[\]{}]/g, '').trim()
const oneLine = (s: string) => s.replace(/[{}\n\r]/g, ' ').trim()
