/**
 * What can be generated with Music.AI, as the checklist offers it, what each piece costs, and which Music.AI jobs a
 * ticked set of pieces needs. One workflow per piece (a workflow always runs its whole graph, and cannot be built
 * through the API, so the choices are separate workflows). Shared by the Worker (prices and checks) and the app
 * (shows the checklist).
 *
 * Rates are Music.AI's own "Estimated (per minute)" of each workflow, read from their dashboard on 2026-11-14, in whole
 * cents. Their API does not return prices, so they live here; when a workflow changes, change the number. These are
 * our costs, not what a customer will be charged. The ledger stores each job's estimate, so past rows keep what they
 * were charged.
 */
export interface Piece {
  id: string
  label: string
  /** ticked at first when a song is new */
  defaultOn: boolean
  /** the Music.AI workflow slug; lyrics has one per language and source (see lyricsWorkflow) */
  workflow: string
  /** cents per minute of audio */
  centsPerMinute: number
}
export const PIECES = [
  { id: 'lyrics', label: 'Lyrics', defaultOn: true, workflow: 'worship-hub-lyrics-<language>', centsPerMinute: 33 },
  { id: 'beats', label: 'Beats', defaultOn: true, workflow: 'worship-hub-beats', centsPerMinute: 3 },
  { id: 'chords', label: 'Chords', defaultOn: true, workflow: 'worship-hub-chords', centsPerMinute: 4 },
  /** includes Beats: the Sections module needs a beat map, so this workflow runs Beats inside it and returns both */
  { id: 'sections', label: 'Sections', defaultOn: true, workflow: 'worship-hub-sections', centsPerMinute: 7 },
  { id: 'stems', label: 'Stems', defaultOn: false, workflow: 'worship-hub-stems-core', centsPerMinute: 50 },
  { id: 'split-vocals', label: 'Split vocals', defaultOn: false, workflow: 'worship-hub-split-vocals', centsPerMinute: 10 },
  { id: 'split-drums', label: 'Split drums', defaultOn: false, workflow: 'worship-hub-split-drums', centsPerMinute: 16 },
  { id: 'split-guitars', label: 'Split guitars', defaultOn: false, workflow: 'worship-hub-split-guitars', centsPerMinute: 10 },
  { id: 'split-guitar-parts', label: 'Split guitar parts', defaultOn: false, workflow: 'worship-hub-split-guitar-parts', centsPerMinute: 10 },
] as const satisfies readonly Piece[]
export type PieceId = (typeof PIECES)[number]['id']
/** Lyrics from a vocal stem skips the vocal separation the full-mix workflow does inside, so it costs less. */
export const LYRICS_FROM_VOCALS_CENTS_PER_MINUTE = 26
export const LANGUAGES = ['en', 'tl'] as const
export type Language = (typeof LANGUAGES)[number]
/** The lyrics workflow for a language, from a full mix, or (with a vocal stem to start from) without the separation. */
export const lyricsWorkflow = (language: Language, fromVocals = false) => `worship-hub-lyrics${fromVocals ? '-from-vocals' : ''}-${language}`
export const isPieceId = (value: unknown): value is PieceId => PIECES.some((p) => p.id === value)
/** Audio longer than this is refused: it caps the cost of one request. */
export const MAX_SECONDS = 10 * 60
const centsFor = (centsPerMinute: number, seconds: number) => Math.max(1, Math.ceil((centsPerMinute * seconds) / 60))
/** The price of a piece for `seconds` of audio, in whole cents (rounded up, never below 1), run on its own from a full mix. */
export function pieceCents(id: PieceId, seconds: number): number {
  const piece = PIECES.find((p) => p.id === id)!
  return centsFor(piece.centsPerMinute, seconds)
}
/** What the song already has, which decides where a job can start from. */
export interface Have {
  /** a stem to start the lyrics or the vocal split from */
  vocals?: boolean
  drums?: boolean
  guitars?: boolean
}
/** One Music.AI job: a ledger row and a charge. */
export interface Job {
  /** the checklist item it is booked under */
  piece: PieceId
  workflow: string
  /** the checklist items whose results this job returns (sections returns beats too, when beats are ticked) */
  provides: PieceId[]
  cents: number
  /** it starts from a stem made by the stems job of the same request, so it waits for that job */
  afterStems: boolean
}
export type Plan = { ok: true; jobs: Job[]; totalCents: number } | { ok: false; reason: string }
const STEM_FOR: Partial<Record<PieceId, keyof Have>> = { 'split-vocals': 'vocals', 'split-drums': 'drums', 'split-guitars': 'guitars', 'split-guitar-parts': 'guitars' }
/**
 * The cheapest set of jobs for the ticked pieces, so nothing is paid twice:
 * - Sections runs Beats inside it, so ticking both is the sections job alone (beats are returned with it).
 * - Lyrics start from the vocal stem (cheaper) when the song has one or the stems are made in the same request;
 *   otherwise from the full mix, separating the vocals inside the workflow.
 * - A split starts from its stem: the song's own, or the one the stems job of the same request makes.
 * `have` is what the song already has. A split with no stem to start from is refused.
 */
export function planJobs(pieces: readonly PieceId[], seconds: number, language: Language = 'en', have: Have = {}): Plan {
  const ticked = PIECES.filter((p) => pieces.includes(p.id))
  const has = (id: PieceId) => ticked.some((p) => p.id === id)
  const withStems = has('stems')
  const jobs: Job[] = []
  for (const piece of ticked) {
    if (piece.id === 'beats' && has('sections')) continue // the sections job returns them
    const need = STEM_FOR[piece.id]
    if (need && !have[need] && !withStems) return { ok: false, reason: `${piece.label} needs the ${need} stem: make the stems first` }
    if (piece.id === 'lyrics') {
      const fromVocals = withStems || !!have.vocals
      jobs.push({ piece: 'lyrics', workflow: lyricsWorkflow(language, fromVocals), provides: ['lyrics'], cents: centsFor(fromVocals ? LYRICS_FROM_VOCALS_CENTS_PER_MINUTE : piece.centsPerMinute, seconds), afterStems: fromVocals && withStems && !have.vocals })
    } else {
      const provides: PieceId[] = piece.id === 'sections' && has('beats') ? ['sections', 'beats'] : [piece.id]
      jobs.push({ piece: piece.id, workflow: piece.workflow, provides, cents: centsFor(piece.centsPerMinute, seconds), afterStems: !!need && withStems && !have[need] })
    }
  }
  return { ok: true, jobs, totalCents: jobs.reduce((total, j) => total + j.cents, 0) }
}
/** The price of the ticked pieces as the jobs `planJobs` makes of them, or null when they cannot run. */
export const estimateCents = (pieces: readonly PieceId[], seconds: number, language: Language = 'en', have: Have = {}): number | null => {
  const plan = planJobs(pieces, seconds, language, have)
  return plan.ok ? plan.totalCents : null
}
export const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`
