/**
 * Chord charts in ChordPro, the usual plain-text format: chords in [brackets] inside the lyrics.
 *
 *   {title: Amazing Grace}
 *   {key: Ab}
 *   {start_of_verse: Verse 1}
 *   [Ab]I love You, Lord
 *   {end_of_verse}
 *   {start_of_chorus: Chorus}
 *   {cue: 0:48.5}            <- where this section starts in the song (m:ss or seconds)
 *   ...
 *   {end_of_chorus}
 *   {comment: Intro}         <- outside a block, starts a section (for instrumentals)
 *   [Ab] [Eb] [Fm] [Db]
 *
 * `{cue: ...}` is not standard ChordPro; it is how a section is tied to the stems.
 */
export interface ChartSegment {
  chord: string
  text: string
}
export type ChartLine = ChartSegment[]
export interface ChartSection {
  label: string
  /** seconds into the song, if the section has a cue */
  t: number | null
  lines: ChartLine[]
}
export interface Chart {
  title: string
  artist: string
  key: string
  sections: ChartSection[]
}

const BLOCK_START = /^start_of_\w+$|^(sov|soc|sob|sot|sog)$/
const BLOCK_END = /^end_of_\w+$|^(eov|eoc|eob|eot|eog)$/
const BLOCK_NAMES: Record<string, string> = { sov: 'Verse', soc: 'Chorus', sob: 'Bridge', sot: 'Tab', sog: 'Grid' }

/** "1:23.5", "83.5" -> seconds, or null when it is not a time. */
export function parseTime(value: string): number | null {
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(value.trim())
  if (!m) return null
  return (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2])
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function parseLine(raw: string): ChartLine {
  const line: ChartLine = []
  const re = /\[([^\]]*)\]/g
  let last = 0
  let chord = ''
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    const text = raw.slice(last, m.index)
    if (text !== '' || chord !== '') line.push({ chord, text })
    chord = m[1].trim()
    last = m.index + m[0].length
  }
  const tail = raw.slice(last)
  if (tail !== '' || chord !== '') line.push({ chord, text: tail })
  return line
}

export function parseChart(source: string): Chart {
  const chart: Chart = { title: '', artist: '', key: '', sections: [] }
  let current: ChartSection | null = null
  let inBlock = false
  const open = (label: string) => {
    current = { label, t: null, lines: [] }
    chart.sections.push(current)
  }
  for (const raw of source.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trimEnd()
    if (line.trimStart().startsWith('#')) continue
    const d = /^\s*\{\s*([a-z_]+)\s*(?::\s*(.*?))?\s*\}\s*$/i.exec(line)
    if (d) {
      const name = d[1].toLowerCase()
      const arg = d[2] ?? ''
      if (name === 'title' || name === 't') chart.title = arg
      else if (name === 'artist') chart.artist = arg
      else if (name === 'key') chart.key = arg
      else if (name === 'cue') {
        const t = parseTime(arg)
        if (t !== null) {
          if (!current) open('')
          // `current` is assigned inside open(), which TypeScript cannot see
          ;(current as ChartSection | null)!.t = t
        }
      } else if (BLOCK_START.test(name)) {
        const kind = name.startsWith('start_of_') ? name.slice(9) : (BLOCK_NAMES[name] ?? name)
        open(arg || kind.charAt(0).toUpperCase() + kind.slice(1))
        inBlock = true
      } else if (BLOCK_END.test(name)) {
        inBlock = false
      } else if ((name === 'comment' || name === 'c') && !inBlock) {
        open(arg)
      }
      continue
    }
    if (line.trim() === '') continue
    if (!current) open('')
    ;(current as ChartSection | null)!.lines.push(parseLine(line))
  }
  return chart
}

/** Index of the section playing at time `t`: the last one whose cue is at or before it. -1 before the first. */
export function activeSection(sections: ChartSection[], t: number): number {
  let active = -1
  let best = -1
  sections.forEach((s, i) => {
    if (s.t !== null && s.t <= t + 0.05 && s.t >= best) {
      best = s.t
      active = i
    }
  })
  return active
}

/** What a line has: chords and words ("cl"), only chords ("c") or only words ("l"). */
export function lineKind(line: ChartLine): 'cl' | 'c' | 'l' {
  const hasWords = line.some((seg) => seg.text.trim() !== '')
  if (!hasWords) return 'c'
  return line.some((seg) => seg.chord !== '') ? 'cl' : 'l'
}
