import { createContext, useContext } from 'react'
/**
 * Where pages draw their header: one element at the top of the app's content area, outside the pages, so
 * the sidebar button and title stay in the same place on every page whatever its width. `shown` is false for
 * a page that is mounted but hidden (Practice), so it does not draw a header over the page in view.
 * `el` is null until the shell has mounted the slot.
 */
export const HeaderSlotContext = createContext<{ el: HTMLElement | null; shown: boolean }>({ el: null, shown: true })
export const useHeaderSlot = () => useContext(HeaderSlotContext)
