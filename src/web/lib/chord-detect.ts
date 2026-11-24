import { knownChord, parseChord } from './chord-shapes'
/**
 * Names the chord that a set of sounding notes makes ("C", "Am7", "G/B"; two notes a fifth or a third apart: "C5",
 * "C(no5)", "Cm(no5)"), or null when they make none: one note, or notes no chord shape below explains. Doubled notes and octaves do not matter; the lowest
 * note is the bass, and a chord whose root is not the bass is written as a slash chord.
 */
const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
/** Chord shapes as intervals from the root, simplest first (ties go to the earlier one). `optional`: may be missing. */
const SHAPES: { name: string; notes: number[]; optional?: number[] }[] = [
  { name: '', notes: [0, 4, 7] },
  { name: 'm', notes: [0, 3, 7] },
  { name: 'sus4', notes: [0, 5, 7] },
  { name: 'sus2', notes: [0, 2, 7] },
  { name: '7', notes: [0, 4, 10], optional: [7] },
  { name: 'maj7', notes: [0, 4, 11], optional: [7] },
  { name: 'm7', notes: [0, 3, 10], optional: [7] },
  { name: 'dim', notes: [0, 3, 6] },
  { name: 'aug', notes: [0, 4, 8] },
  { name: '6', notes: [0, 4, 9], optional: [7] },
  { name: 'm6', notes: [0, 3, 9], optional: [7] },
  { name: 'add9', notes: [0, 2, 4], optional: [7] },
  { name: 'madd9', notes: [0, 2, 3], optional: [7] },
  { name: '7sus4', notes: [0, 5, 10], optional: [7] },
  { name: 'm7b5', notes: [0, 3, 6, 10] },
  { name: 'dim7', notes: [0, 3, 6, 9] },
  { name: 'mmaj7', notes: [0, 3, 11], optional: [7] },
  { name: '9', notes: [0, 2, 4, 10], optional: [7] },
  { name: 'maj9', notes: [0, 2, 4, 11], optional: [7] },
  { name: 'm9', notes: [0, 2, 3, 10], optional: [7] },
  // piano voicings often leave the third out: root, fifth and seventh still name the chord
  { name: 'maj7', notes: [0, 7, 11] },
  { name: '7', notes: [0, 7, 10] },
  { name: 'aug7', notes: [0, 4, 8, 10] },
  { name: 'maj7#5', notes: [0, 4, 8, 11] },
  // two notes: root and fifth (a power chord), root and third with the fifth left out
  { name: '5', notes: [0, 7] },
  { name: '(no5)', notes: [0, 4] },
  { name: 'm(no5)', notes: [0, 3] },
]
/**
 * `pitches`: MIDI note numbers sounding together. `flats`: spell with flats (as the song's key does). Returns the
 * chord name, or null.
 */
export function chordFromNotes(pitches: number[], flats = false): string | null {
  if (pitches.length === 0) return null
  const pcs = [...new Set(pitches.map((p) => ((p % 12) + 12) % 12))]
  if (pcs.length < 2) return null
  const bass = ((Math.min(...pitches) % 12) + 12) % 12
  const names = flats ? FLATS : SHARPS
  let best: { name: string; score: number } | null = null
  SHAPES.forEach((shape, rank) => {
    for (const root of pcs) {
      const rel = new Set(pcs.map((pc) => (pc - root + 12) % 12))
      const all = new Set([...shape.notes, ...(shape.optional ?? [])])
      // every required note sounds, and nothing sounds that the shape does not have
      if (!shape.notes.every((i) => rel.has(i)) || [...rel].some((i) => !all.has(i))) continue
      // a whole chord first (G B E is Em over G, not G6 with no fifth), then one built on the bass, then the simpler shape
      const missing = (shape.optional ?? []).filter((i) => !rel.has(i)).length
      const score = missing * 1000 + (root === bass ? 0 : 100) + rank
      if (!best || score < best.score) best = { name: names[root] + shape.name + (root === bass ? '' : `/${names[bass]}`), score }
    }
  })
  return best === null ? null : (best as { name: string }).name
}
/** Whether a piece reads best with flats: the major key whose scale holds most of its notes (by time held) is a flat key. */
export function prefersFlatsFor(notes: { pitch: number; t: number; end: number }[]): boolean {
  const weight = new Array<number>(12).fill(0)
  for (const n of notes) weight[n.pitch % 12] += n.end - n.t
  const scale = [0, 2, 4, 5, 7, 9, 11]
  let best = 0
  let bestScore = -1
  for (let k = 0; k < 12; k++) {
    const score = scale.reduce((s, i) => s + weight[(k + i) % 12], 0)
    if (score > bestScore) [best, bestScore] = [k, score]
  }
  // F, Bb, Eb, Ab, Db, Gb
  return [5, 10, 3, 8, 1, 6].includes(best)
}
/** How many inversions a chord has: one fewer than its notes (a triad: root position, 1st, 2nd). */
export function inversionsOf(name: string): number {
  const chord = knownChord(name) ? parseChord(name) : null
  return chord ? chord.notes.length - 1 : 0
}
/**
 * The keys to press for a chord name, lowest first. The chord (the right hand) starts in C4..B4: root position, or
 * with `inversion` 1, 2, 3 starting from its 2nd, 3rd, 4th note (C 1st inversion: E G C). A slash chord adds its bass
 * note in the left hand, an octave or so lower (C3..B3): C/E is E3 under C4 E4 G4 (`bass` is that note, null without
 * a slash). null for a name that is not a chord (or a quality not known).
 */
export function chordKeys(name: string, inversion = 0): { keys: number[]; bass: number | null; chord: number[] } | null {
  if (!knownChord(name)) return null
  const parsed = parseChord(name)
  if (!parsed) return null
  const fromRoot = (pc: number) => (pc - parsed.root + 12) % 12
  const tones = [...parsed.notes].sort((a, b) => fromRoot(a) - fromRoot(b))
  const start = Math.min(Math.max(0, Math.floor(inversion)), tones.length - 1)
  const order = [...tones.slice(start), ...tones.slice(0, start)]
  const chord: number[] = []
  let last = 59
  for (const pc of order) {
    let p = last + 1
    while (p % 12 !== pc) p++
    chord.push(p)
    last = p
  }
  const slash = name.includes('/')
  const bass = slash ? 48 + parsed.bass : null
  return { keys: bass === null ? chord : [bass, ...chord], bass, chord }
}
