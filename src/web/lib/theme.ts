/** Church branding on the page; the rules and colour maths are in src/shared/theme.ts (the CLI uses them too). */
import { themeVariables, type ChurchTheme } from '../../shared/theme'

export * from '../../shared/theme'

/** Puts a church's theme on the page; with no theme, the default. */
export function applyTheme(theme: ChurchTheme, root: HTMLElement = document.documentElement) {
  for (const [name, value] of Object.entries(themeVariables(theme))) root.style.setProperty(name, value)
}
