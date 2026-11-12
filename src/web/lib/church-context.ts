import { createContext, useContext } from 'react'
import type { Request, Role } from '../../shared/permissions'
import type { ChurchTheme } from './theme'

export interface ChurchInfo {
  id: string
  name: string
  slug: string
  /** the church's branding (colours, app name); empty for the default */
  theme: ChurchTheme
  /** https URL of the church's logo, if it has one */
  logo: string | null
}

/** The church the signed-in person is working in (ChurchGate in church.tsx provides it). */
export interface ChurchValue {
  id: string
  name: string
  theme: ChurchTheme
  logo: string | null
  role: Role | null
  churches: ChurchInfo[]
  /** whether the person's role includes this permission (the Worker enforces it; this only shows or hides controls) */
  can: (permission: Request) => boolean
  /** makes another church active; the app then reloads at Practice so nothing of the old one stays open */
  switchTo: (id: string) => Promise<void>
}

/** Outside ChurchGate (tests, screens before sign-in): no church and no permissions. */
export const ChurchContext = createContext<ChurchValue>({
  id: '',
  name: '',
  theme: {},
  logo: null,
  role: null,
  churches: [],
  can: () => false,
  switchTo: async () => {},
})

export function useChurch() {
  return useContext(ChurchContext)
}

/** Which church to open for someone with none active: their only church, else the last one used here, else they choose. */
export function pickChurch(churches: { id: string }[], last: string): string | null {
  if (churches.length === 1) return churches[0].id
  return churches.find((c) => c.id === last)?.id ?? null
}

