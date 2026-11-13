/** The Practice player's tempo, as a rate of the recording's (1.1 = 10 % faster): steps and memory per song. */
import { MAX_TEMPO, MIN_TEMPO } from './engine'

const TEMPO_KEY = 'worship-hub:tempo'
/** The tempo this device last used for a song (a rate of the recording's), 1 when none. */
export function savedTempo(songId: string): number {
  try {
    const all = JSON.parse(localStorage.getItem(TEMPO_KEY) ?? '{}') as Record<string, unknown>
    const r = all[songId]
    return typeof r === 'number' && r >= MIN_TEMPO && r <= MAX_TEMPO ? r : 1
  } catch {
    return 1
  }
}
export function saveTempo(songId: string, rate: number) {
  try {
    const all = JSON.parse(localStorage.getItem(TEMPO_KEY) ?? '{}') as Record<string, number>
    if (rate === 1) delete all[songId]
    else all[songId] = rate
    localStorage.setItem(TEMPO_KEY, JSON.stringify(all))
  } catch {
    // storage blocked: the tempo just is not remembered
  }
}
/**
 * One step faster (+1) or slower (-1): a whole BPM when the song's tempo is known (so the panel shows
 * round numbers), else 5 %. Kept within MIN_TEMPO..MAX_TEMPO; close to the recording snaps back to 1.
 */
export function stepTempo(rate: number, bpm: number | undefined, dir: 1 | -1): number {
  const next = bpm && bpm > 0 ? (Math.round(bpm * rate) + dir) / bpm : Math.round(rate * 20 + dir) / 20
  const clamped = Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, next))
  return Math.abs(clamped - 1) < 1e-6 || (bpm && Math.round(bpm * clamped) === Math.round(bpm)) ? 1 : clamped
}

