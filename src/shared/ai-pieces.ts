/**
 * What can be generated with Music.AI, as the checklist offers it, and what each piece costs. One piece is one
 * Music.AI workflow (a workflow always runs its whole graph, and cannot be built through the API, so the
 * choices are separate workflows). Shared by the Worker (prices and checks) and the app (shows the checklist).
 *
 * RATES ARE PROVISIONAL: they come from Music.AI's pay-as-you-go price list as I know it (per minute of audio:
 * chords 4 cents, beats 3, sections 4 on top of beats, lyrics 17 + word alignment 9 on top of vocal separation,
 * about 7 per stem module). Replace them with each workflow's "Estimated (per minute)" from the Music.AI
 * dashboard once the workflows exist; the ledger stores every estimate, so past rows keep what they were charged.
 */
export type PieceId = 'beats' | 'chords' | 'sections' | 'lyrics' | 'stems' | 'split-vocals' | 'split-drums' | 'split-guitars' | 'split-guitar-parts'

export interface Piece {
  id: PieceId
  label: string
  /** ticked at first when a song is new */
  defaultOn: boolean
  /** the Music.AI workflow slug; lyrics has one per language (see lyricsWorkflow) */
  workflow: string
  /** cents per minute of audio */
  centsPerMinute: number
}

export const PIECES: readonly Piece[] = [
  { id: 'lyrics', label: 'Lyrics', defaultOn: true, workflow: 'worship-hub-lyrics-<language>', centsPerMinute: 33 },
  { id: 'beats', label: 'Beats', defaultOn: true, workflow: 'worship-hub-beats', centsPerMinute: 3 },
  { id: 'chords', label: 'Chords', defaultOn: true, workflow: 'worship-hub-chords', centsPerMinute: 4 },
  { id: 'sections', label: 'Sections', defaultOn: true, workflow: 'worship-hub-sections', centsPerMinute: 7 },
  { id: 'stems', label: 'Stems', defaultOn: false, workflow: 'worship-hub-stems-core', centsPerMinute: 70 },
  { id: 'split-vocals', label: 'Split vocals', defaultOn: false, workflow: 'worship-hub-split-vocals', centsPerMinute: 8 },
  { id: 'split-drums', label: 'Split drums', defaultOn: false, workflow: 'worship-hub-split-drums', centsPerMinute: 20 },
  { id: 'split-guitars', label: 'Split guitars', defaultOn: false, workflow: 'worship-hub-split-guitars', centsPerMinute: 8 },
  { id: 'split-guitar-parts', label: 'Split guitar parts', defaultOn: false, workflow: 'worship-hub-split-guitar-parts', centsPerMinute: 8 },
] as const

export const LANGUAGES = ['en', 'tl'] as const
export type Language = (typeof LANGUAGES)[number]

/** The lyrics workflow for a language, from a full mix, or (with a vocal stem to start from) without the separation. */
export const lyricsWorkflow = (language: Language, fromVocals = false) => `worship-hub-lyrics${fromVocals ? '-from-vocals' : ''}-${language}`

export const isPieceId = (value: unknown): value is PieceId => PIECES.some((p) => p.id === value)

/** Audio longer than this is refused: it caps the cost of one request. */
export const MAX_SECONDS = 10 * 60

/** The price of a piece for `seconds` of audio, in whole cents (rounded up, never below 1). */
export function pieceCents(id: PieceId, seconds: number): number {
  const piece = PIECES.find((p) => p.id === id)!
  return Math.max(1, Math.ceil((piece.centsPerMinute * seconds) / 60))
}

/** The price of the ticked pieces, each priced on its own (a piece is a job, and a job is a ledger row). */
export const estimateCents = (ids: readonly PieceId[], seconds: number): number => ids.reduce((total, id) => total + pieceCents(id, seconds), 0)

export const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`
