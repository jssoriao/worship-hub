/**
 * How a chart is shown. Columns, chord style and text size are the same for every song on this
 * device; key and capo are remembered per song.
 */
import { chordNumber, parseKey, prefersFlats, shiftKey, transposeChord, type Key } from './chords'

export type ColumnsSetting = 'auto' | 1 | 2
export type Paper = 'light' | 'dark'
export interface ViewSettings {
  columns: ColumnsSetting
  numbers: boolean
  /** text size, 1 = normal; 'fit' = the largest that shows the whole chart at once */
  scale: number | 'fit'
  paper: Paper
}
export interface SongSettings {
  /** semitones from the chart's key */
  transpose: number
  capo: number
}

/** The frame of a section on a sheet (also used to measure it, so both must match). */
export const SECTION_CLASS = 'border-l-2 pl-[0.6em]'

const VIEW_KEY = 'worship-hub:chart-view'
const songKey = (id: string) => `worship-hub:chart:${id}`
/** text sizes A− / A+ step through */
export const SCALES = [0.6, 0.7, 0.8, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2, 2.3]

function read<T>(key: string): Partial<T> {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<T> | null) ?? {}
  } catch {
    return {}
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage blocked: the setting just is not remembered
  }
}

export function loadView(): ViewSettings {
  const v = read<ViewSettings>(VIEW_KEY)
  return {
    columns: v.columns === 1 || v.columns === 2 ? v.columns : 'auto',
    numbers: v.numbers === true,
    scale: typeof v.scale === 'number' && SCALES.includes(v.scale) ? v.scale : 'fit',
    paper: v.paper === 'dark' ? 'dark' : 'light',
  }
}
export const saveView = (v: ViewSettings) => write(VIEW_KEY, v)

export function loadSong(id: string): SongSettings {
  const s = read<SongSettings>(songKey(id))
  const int = (n: unknown, lo: number, hi: number) => (typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi ? n : 0)
  return { transpose: int(s.transpose, -11, 11), capo: int(s.capo, 0, 11) }
}
export function saveSong(id: string, s: SongSettings) {
  if (s.transpose === 0 && s.capo === 0) {
    try {
      localStorage.removeItem(songKey(id))
    } catch {
      // ignore
    }
  } else write(songKey(id), s)
}

/** What a chart shows for its chords and key, given the settings. */
export function chordDisplay(chartKey: string, song: SongSettings, view: ViewSettings) {
  const original: Key | null = parseKey(chartKey)
  // the key it sounds in, and the shapes played with a capo
  const sounding = original ? shiftKey(original, song.transpose) : null
  const shapes = sounding ? shiftKey(sounding, -song.capo) : null
  const shapeShift = song.transpose - song.capo
  const show = (chord: string) => {
    if (view.numbers && original) return chordNumber(chord, original)
    return transposeChord(chord, shapeShift, prefersFlats(shapes, chord))
  }
  return { original, sounding, shapes, show, canNumber: original !== null }
}
