/**
 * The churches and role the app last opened with, so the next start shows the app at once while fresh copies
 * load. Only used for the same person and the same active church; the Worker still checks every request.
 * Sign-out clears it (forgetChurches).
 */
import { isRole, type Role } from '../../shared/permissions'
import type { ChurchInfo } from './church-context'

const KEY = 'worship-hub:churches'

export interface SavedChurches {
  userId: string
  activeId: string
  churches: ChurchInfo[]
  role: Role | null
}

/** The saved copy for this person with this active church, else null. */
export function savedChurches(userId: string, activeId: string): SavedChurches | null {
  if (!userId || !activeId) return null
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as SavedChurches | null
    if (!saved || saved.userId !== userId || saved.activeId !== activeId || !Array.isArray(saved.churches)) return null
    if (!saved.churches.some((c) => c?.id === activeId)) return null
    return { ...saved, role: isRole(saved.role) ? saved.role : null }
  } catch {
    return null
  }
}

export function saveChurches(saved: SavedChurches): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved))
  } catch {
    // storage full or blocked: the app just loads as before
  }
}

/** Used on sign-out. */
export function forgetChurches(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // storage blocked
  }
}
