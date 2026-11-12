import { createContext, useContext } from 'react'
import type { Request, Role } from '../../shared/permissions'

export interface ChurchInfo {
  id: string
  name: string
  slug: string
}

/** The church the signed-in person is working in. In dev (no sign-in) there is one stand-in church with every permission. */
export interface ChurchValue {
  id: string
  name: string
  role: Role | null
  churches: ChurchInfo[]
  /** whether the person's role includes this permission (the Worker enforces it; this only shows or hides controls) */
  can: (permission: Request) => boolean
  /** makes another church active; the app then reloads at Practice so nothing of the old one stays open */
  switchTo: (id: string) => Promise<void>
}

export const DEV_CHURCH = 'dev'

export const ChurchContext = createContext<ChurchValue>({
  id: DEV_CHURCH,
  name: 'Dev',
  role: 'owner',
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

