/** The church's Music.AI credits (owners): this month's use, and a price for a request. */
import type { Have, Language, PieceId } from '../../shared/ai-pieces'
import { aiApi, call } from './api'

export const getCredits = () => call(aiApi.$get())
export type Credits = Awaited<ReturnType<typeof getCredits>>['usage']
export const priceOf = (pieces: PieceId[], seconds: number, language: Language = 'en', have: Have = {}) => call(aiApi.estimate.$post({ json: { pieces, seconds, language, have } }))
