/**
 * Chord names: transposing, and Nashville numbers relative to a key.
 *
 *   transposeChord('E/G#', 2, false) -> 'F#/A#'
 *   chordNumber('E/G#', 'A')         -> '5/7'
 *   chordNumber('F#m', 'A')          -> '6m'
 */
const SHARPS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
/** Keys written with flats (major, and minor with an "m"). The rest use sharps. */
const FLAT_KEYS = new Set(['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm'])
const DEGREES = ['1', 'b2', '2', 'b3', '3', '4', '#4', '5', 'b6', '6', 'b7', '7']
/** root, the rest of the name (quality, extensions), and an optional bass note after "/" */
const CHORD = /^([A-G])([#b]?)([^/]*)(?:\/([A-G])([#b]?))?$/

const mod12 = (n: number) => ((n % 12) + 12) % 12

function pitch(letter: string, accidental: string): number {
  return mod12(LETTER[letter] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0))
}

export interface Key {
  tonic: number
  minor: boolean
}

/** "A", "Ab", "F#m", "Bm", "D major", "B minor" -> a key; null when it is not one. */
export function parseKey(raw: string): Key | null {
  const m = /^\s*([A-G])([#b]?)\s*(m(?:in(?:or)?)?|maj(?:or)?)?\s*$/i.exec(raw.replace('♯', '#').replace('♭', 'b'))
  if (!m) return null
  const letter = m[1].toUpperCase()
  return { tonic: pitch(letter, m[2]), minor: !!m[3] && m[3].toLowerCase().startsWith('m') && !m[3].toLowerCase().startsWith('maj') }
}

/** Whether a key is written with flats. */
function flatKey(key: Key): boolean {
  return FLAT_KEYS.has(SHARPS[key.tonic] + (key.minor ? 'm' : '')) || FLAT_KEYS.has(FLATS[key.tonic] + (key.minor ? 'm' : ''))
}

/** A key's usual name: "Ab", "F#m", "Bb". */
export function keyName(key: Key): string {
  const names = flatKey(key) ? FLATS : SHARPS
  return names[key.tonic] + (key.minor ? 'm' : '')
}

/** The key `semitones` up (or down) from `key`. */
export function shiftKey(key: Key, semitones: number): Key {
  return { tonic: mod12(key.tonic + semitones), minor: key.minor }
}

/** Whether chords in `key` should be spelled with flats (no key: keep what the chord used). */
export function prefersFlats(key: Key | null, chord = ''): boolean {
  return key ? flatKey(key) : /^[A-G]b/.test(chord)
}

/** Moves a chord by `semitones`. Text that is not a chord ("N.C.", "x2") is left as it is. */
export function transposeChord(chord: string, semitones: number, flats: boolean): string {
  if (semitones % 12 === 0) return chord
  const m = CHORD.exec(chord.trim())
  if (!m) return chord
  const names = flats ? FLATS : SHARPS
  const root = names[mod12(pitch(m[1], m[2]) + semitones)]
  const bass = m[4] ? `/${names[mod12(pitch(m[4], m[5] ?? '') + semitones)]}` : ''
  return root + m[3] + bass
}

/** A chord as a Nashville number in `key` (degrees of the major scale; minor keys count from their relative major). */
export function chordNumber(chord: string, key: Key): string {
  const m = CHORD.exec(chord.trim())
  if (!m) return chord
  const one = key.minor ? mod12(key.tonic + 3) : key.tonic
  const degree = (letter: string, accidental: string) => DEGREES[mod12(pitch(letter, accidental) - one)]
  const bass = m[4] ? `/${degree(m[4], m[5] ?? '')}` : ''
  return degree(m[1], m[2]) + m[3] + bass
}
