import { createContext, useContext } from 'react'

/**
 * Where the Practice page draws its play bar: an element docked to the bottom of the app, outside the
 * (sometimes hidden) Practice page, so the compact player stays on every page while a song is open.
 * Null until the shell has mounted it.
 */
export const PlayerSlotContext = createContext<HTMLElement | null>(null)

export const usePlayerSlot = () => useContext(PlayerSlotContext)
