/**
 * The last next service Home showed, per church, so the card appears at once on the next visit while a fresh
 * copy loads. It holds names of people serving, so sign-out clears it (forgetNextServices).
 */
import type { ServiceFull } from './services-api'

const PREFIX = 'worship-hub:next-service:'

/** The saved next service of `churchId`, unless it is missing, unreadable or already past `today`. */
export function savedNextService(churchId: string, today: string): ServiceFull | null | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + churchId)
    if (raw === null) return undefined
    const saved = JSON.parse(raw) as { service: ServiceFull | null }
    if (saved.service === null) return null
    return typeof saved.service?.date === 'string' && saved.service.date >= today && Array.isArray(saved.service.items) ? saved.service : undefined
  } catch {
    return undefined
  }
}

/** Remembers what Home just loaded for `churchId` (null: the church has no upcoming service). */
export function saveNextService(churchId: string, service: ServiceFull | null): void {
  try {
    localStorage.setItem(PREFIX + churchId, JSON.stringify({ service }))
  } catch {
    // storage full or blocked: the card just loads as before
  }
}

/** Every church's saved next service. Used on sign-out. */
export function forgetNextServices(): void {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX)) localStorage.removeItem(key)
  } catch {
    // nothing saved, or storage blocked
  }
}
