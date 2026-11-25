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

/** The shortest move from one key's tonic to another's, -5 to +6 semitones (the mode is ignored). */
export function semitonesBetween(from: Key, to: Key): number {
  const up = mod12(to.tonic - from.tonic)
  return up > 6 ? up - 12 : up
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

/** The same chord spelled with sharps or flats: respellChord('G#m7/D#', true) -> 'Abm7/Eb'. */
export function respellChord(chord: string, flats: boolean): string {
  const m = CHORD.exec(chord.trim())
  if (!m) return chord
  const names = flats ? FLATS : SHARPS
  // a natural note is spelled the same either way (keeps "E#" or "Cb" out of the names list)
  const name = (letter: string, accidental: string) => (accidental ? names[pitch(letter, accidental)] : letter)
  return name(m[1], m[2]) + m[3] + (m[4] ? `/${name(m[4], m[5] ?? '')}` : '')
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
/** A number's degree, "b3", "#4", "5" -> semitones above 1. */
const STEP: Record<string, number> = { '1': 0, '2': 2, '3': 4, '4': 5, '5': 7, '6': 9, '7': 11 }
/** degree, the rest (quality), and an optional bass degree after "/" */
const NUMBER = /^([b#]?)([1-7])([^/]*)(?:\/([b#]?)([1-7]))?$/
/**
 * A Nashville number back to a chord in `key`, as chordNumber writes it: "6m7" in A is F#m7, "5/7" is E/G#, "b7" in C is
 * Bb. Minor keys count from their relative major. A degree with a flat is spelled with flats, with a sharp with sharps,
 * otherwise as the key is written. null when the text is not a number (a chord name, say), so the caller keeps it.
 */
export function numberChord(text: string, key: Key): string | null {
  const m = NUMBER.exec(text.trim().replace('♭', 'b').replace('♯', '#'))
  if (!m) return null
  const one = key.minor ? mod12(key.tonic + 3) : key.tonic
  const note = (acc: string, digit: string) => {
    const pc = mod12(one + STEP[digit] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0))
    return (acc === 'b' ? FLATS : acc === '#' ? SHARPS : flatKey(key) ? FLATS : SHARPS)[pc]
  }
  return note(m[1], m[2]) + m[3] + (m[5] ? `/${note(m[4] ?? '', m[5])}` : '')
}
