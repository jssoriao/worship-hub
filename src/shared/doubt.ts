/**
 * Words the speech-to-text was not sure of. Music.AI scores each word 0..1; a word under DOUBT_BELOW is kept
 * in analysis.json as a fourth number, its score in percent, so editors can review it. A word without
 * that number is trusted (it scored well, or a person checked or retyped it).
 */
export const DOUBT_BELOW = 0.4
/** The score as stored (whole percent), or null when the word is sure enough to need no review. */
export const doubtOf = (score: unknown): number | null =>
  typeof score === 'number' && Number.isFinite(score) && score >= 0 && score < DOUBT_BELOW ? Math.round(score * 100) : null
