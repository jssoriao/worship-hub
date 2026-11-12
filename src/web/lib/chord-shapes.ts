/**
 * Chord shapes: the notes of a chord (for piano) and a playable guitar fingering, worked out from
 * the chord's name, so no chord library is needed.
 *
 * Guitar: a search over standard tuning for the easiest voicing that has every note of the chord
 * (the fifth may be left out), the right bass note lowest, no muted string between played ones, at
 * most four fingers (one may barre), within four frets; open strings and low positions preferred.
 */
const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

/** Intervals in semitones from the root, by chord quality as written after the root. */
const QUALITIES: Record<string, number[]> = {
  '': [0, 4, 7],
  maj: [0, 4, 7],
  m: [0, 3, 7],
  min: [0, 3, 7],
  '5': [0, 7],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  M7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  mmaj7: [0, 3, 7, 11],
  '9': [0, 4, 7, 10, 2],
  maj9: [0, 4, 7, 11, 2],
  m9: [0, 3, 7, 10, 2],
  add9: [0, 4, 7, 2],
  add2: [0, 4, 7, 2],
  madd9: [0, 3, 7, 2],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  sus: [0, 5, 7],
  '7sus4': [0, 5, 7, 10],
  '11': [0, 4, 7, 10, 5],
  m11: [0, 3, 7, 10, 5],
  '13': [0, 4, 7, 10, 9],
  dim: [0, 3, 6],
  dim7: [0, 3, 6, 9],
  m7b5: [0, 3, 6, 10],
  aug: [0, 4, 8],
  '+': [0, 4, 8],
}

export interface ParsedChord {
  root: number
  /** pitch classes, root first */
  notes: number[]
  bass: number
  /** spell with flats */
  flats: boolean
}

/** "F#m7", "Gadd9", "D/F#", "Bb" -> notes; null when it is not a chord. */
export function parseChord(name: string): ParsedChord | null {
  const m = /^([A-G])([#b]?)([^/]*)(?:\/([A-G])([#b]?))?$/.exec(name.trim())
  if (!m) return null
  const pc = (l: string, acc: string) => (NOTE[l] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + 12) % 12
  const root = pc(m[1], m[2])
  const quality = m[3]
  const intervals = QUALITIES[quality] ?? (quality.startsWith('m') && !quality.startsWith('maj') ? [0, 3, 7] : [0, 4, 7])
  const notes = [...new Set(intervals.map((i) => (root + i) % 12))]
  const bass = m[4] ? pc(m[4], m[5] ?? '') : root
  return { root, notes, bass, flats: m[2] === 'b' || (m[5] ?? '') === 'b' }
}

export const noteName = (pc: number, flats: boolean) => (flats ? FLAT_NAMES : SHARP_NAMES)[pc]

/** Standard tuning, low E to high E. */
const STRINGS = [4, 9, 2, 7, 11, 4]
export const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'E']

export interface GuitarShape {
  /** per string, low E first: -1 muted, 0 open, else the fret */
  frets: number[]
  /** per string: finger 1–4, 0 none */
  fingers: number[]
  /** fret drawn at the top of the diagram */
  baseFret: number
  /** a barre: finger 1 across these strings at this fret */
  barre?: { fret: number; from: number; to: number }
}

const cache = new Map<string, GuitarShape | null>()

/** The usual shapes of the major and minor chords (low E first, x = muted). */
const STANDARD: Record<string, string> = {
  C: 'x32010', 'C#': 'x46664', D: 'xx0232', Eb: 'x68886', E: '022100', F: '133211',
  'F#': '244322', G: '320003', Ab: '466544', A: 'x02220', Bb: 'x13331', B: 'x24442',
  Cm: 'x35543', 'C#m': 'x46654', Dm: 'xx0231', Ebm: 'x68876', Em: '022000', Fm: '133111',
  'F#m': '244222', Gm: '355333', 'G#m': '466444', Am: 'x02210', Bbm: 'x13321', Bm: 'x24432',
}
const SAME: Record<string, string> = { Db: 'C#', 'D#': 'Eb', Gb: 'F#', 'G#': 'Ab', 'A#': 'Bb', Dbm: 'C#m', 'D#m': 'Ebm', Gbm: 'F#m', Abm: 'G#m', 'A#m': 'Bbm' }

/**
 * The guitar fingering for a chord name, or null. A slash chord shows the shape of the chord
 * itself (D/F# as D), as chord sheets usually do; its name keeps the bass note.
 */
export function guitarShape(name: string): GuitarShape | null {
  const plain = name.trim().split('/')[0]
  if (cache.has(plain)) return cache.get(plain)!
  const known = STANDARD[SAME[plain] ?? plain]
  let shape: GuitarShape | null = null
  if (known) {
    shape = withFingers([...known].map((c) => (c === 'x' ? -1 : Number(c))))
  } else {
    const chord = parseChord(plain)
    shape = chord ? search(chord) : null
  }
  cache.set(plain, shape)
  return shape
}

function search(chord: ParsedChord): GuitarShape | null {
  const tones = new Set(chord.notes)
  const fifth = (chord.root + 7) % 12
  const required = chord.notes.filter((n) => n !== fifth || chord.notes.length <= 2)
  let best: { frets: number[]; score: number } | null = null
  for (let pos = 1; pos <= 10; pos++) {
    // options per string: muted, open (if a chord tone), or a fret in pos..pos+3 that is a chord tone
    const options = STRINGS.map((open) => {
      const o = [-1]
      if (tones.has(open % 12)) o.push(0)
      for (let f = pos; f < pos + 4; f++) if (tones.has((open + f) % 12)) o.push(f)
      return o
    })
    const frets = new Array<number>(6).fill(-1)
    const walk = (s: number) => {
      if (s === 6) {
        const score = rate(frets, chord, required)
        if (score !== null && (!best || score < best.score)) best = { frets: [...frets], score }
        return
      }
      for (const f of options[s]) {
        frets[s] = f
        walk(s + 1)
      }
    }
    walk(0)
  }
  return best ? withFingers((best as { frets: number[] }).frets) : null
}

/** Lower is easier; null when the voicing is not a good one for this chord. */
function rate(frets: number[], chord: ParsedChord, required: number[]): number | null {
  const played = frets.map((f, s) => (f >= 0 ? s : -1)).filter((s) => s >= 0)
  if (played.length < 3) return null
  const first = played[0]
  const last = played[played.length - 1]
  // no muted string between played ones
  if (played.length !== last - first + 1) return null
  // the right bass note lowest
  if ((STRINGS[first] + frets[first]) % 12 !== chord.bass) return null
  const sounding = new Set(played.map((s) => (STRINGS[s] + frets[s]) % 12))
  if (required.some((n) => !sounding.has(n))) return null
  const fretted = played.filter((s) => frets[s] > 0)
  const min = fretted.length ? Math.min(...fretted.map((s) => frets[s])) : 0
  const max = fretted.length ? Math.max(...fretted.map((s) => frets[s])) : 0
  if (max - min > 3) return null
  if (fingersNeeded(frets) > 4) return null
  // a barre (more than four fretted notes) covers every string from its lowest one up: none open
  if (fretted.length > 4) {
    const from = fretted.find((s) => frets[s] === min)!
    if (played.some((s) => s > from && frets[s] === 0)) return null
  }
  const opens = played.filter((s) => frets[s] === 0).length
  // open strings help near the nut; next to notes high up the neck they are awkward
  const openCost = max > 3 ? opens * 2.5 : -opens * 0.8
  // high up the neck, an open string between fretted notes is a stretch
  const inner = max > 3 ? played.filter((s) => frets[s] === 0 && played.some((a) => a < s && frets[a] > 0) && played.some((b) => b > s && frets[b] > 0)).length : 0
  return min * 3 + (max - min) * 1.5 + (6 - played.length) * 2 + openCost + inner * 2 + fretted.length * 0.3 + first * 0.5
}

/** Fingers a voicing needs, with the lowest fret barred when that saves fingers. */
function fingersNeeded(frets: number[]): number {
  const fretted = frets.filter((f) => f > 0)
  if (fretted.length <= 4) return fretted.length
  const min = Math.min(...fretted)
  return 1 + fretted.filter((f) => f > min).length
}

function withFingers(frets: number[]): GuitarShape {
  const fretted = frets.map((f, s) => ({ f, s })).filter((x) => x.f > 0)
  const fingers = new Array<number>(6).fill(0)
  const min = fretted.length ? Math.min(...fretted.map((x) => x.f)) : 0
  const max = fretted.length ? Math.max(...fretted.map((x) => x.f)) : 0
  let barre: GuitarShape['barre']
  const atMin = fretted.filter((x) => x.f === min)
  let next = 1
  if (fretted.length > 4 && atMin.length >= 2) {
    // finger 1 lies across every string from the lowest one at that fret
    const from = atMin[0].s
    barre = { fret: min, from, to: 5 }
    for (const x of fretted) if (x.f === min && x.s >= from) fingers[x.s] = 1
    next = 2
  }
  for (const x of [...fretted].sort((a, b) => a.f - b.f || a.s - b.s)) {
    if (fingers[x.s] === 0) fingers[x.s] = Math.min(4, next++)
  }
  const baseFret = max <= 4 ? 1 : min
  return { frets, fingers, baseFret, barre }
}
