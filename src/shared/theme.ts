/**
 * Church branding (white label). A church sets up to two colours, and optionally an app name and a
 * logo; every other colour in src/web/index.css is derived from them. Stored as JSON in the church's
 * `organizations.metadata` (`{ "theme": { "brand": "#2563eb", "brand2": "#6366f1", "appName": "..." } }`,
 * set with `pnpm churches theme`), the logo in `organizations.logo`.
 *
 * The page is always dark, so the only checks needed are contrast ones: text on the brand colour is
 * white or near-black, whichever reads better, and brand-coloured text and focus rings on the dark
 * page are lightened when the brand colour is too dark to read there.
 */

export interface ChurchTheme {
  /** main colour: buttons, focus, the selected thing (#rrggbb) */
  brand?: string
  /** second colour: the other end of gradients and the page glow (#rrggbb) */
  brand2?: string
  /** shown instead of "Worship Hub" */
  appName?: string
}

export const DEFAULT_THEME = { brand: '#2563eb', brand2: '#7c3aed', appName: 'Worship Hub' } as const

const HEX = /^#[0-9a-f]{6}$/i
export const isHexColour = (value: unknown): value is string => typeof value === 'string' && HEX.test(value)

/** The theme in a church's metadata (a JSON string, as Better Auth stores it, or an object); bad values are dropped. */
export function themeFromMetadata(metadata: unknown): ChurchTheme {
  let data: unknown = metadata
  if (typeof metadata === 'string') {
    try {
      data = JSON.parse(metadata)
    } catch {
      return {}
    }
  }
  const theme = (data as { theme?: Record<string, unknown> } | null)?.theme
  if (!theme || typeof theme !== 'object') return {}
  const appName = typeof theme.appName === 'string' ? theme.appName.trim().slice(0, 40) : ''
  return {
    ...(isHexColour(theme.brand) ? { brand: theme.brand } : {}),
    ...(isHexColour(theme.brand2) ? { brand2: theme.brand2 } : {}),
    ...(appName ? { appName } : {}),
  }
}

// ---------------------------------------------------------------- colour maths (sRGB -> OKLCH)

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

function rgbOf(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255) as [number, number, number]
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex).map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio between two luminances. */
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

/** OKLCH lightness, chroma and hue of a colour. */
export function oklchOf(hex: string): { l: number; c: number; h: number } {
  const [r, g, b] = rgbOf(hex).map(toLinear)
  const l_ = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m_ = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s_ = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_
  const A = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_
  const B = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_
  const h = (Math.atan2(B, A) * 180) / Math.PI
  return { l: L, c: Math.hypot(A, B), h: h < 0 ? h + 360 : h }
}

const NEAR_BLACK = '#0b1020'

/** Text colour on the brand colour: white unless near-black reads clearly better. */
export function foregroundOn(hex: string): string {
  const bg = luminance(hex)
  return contrast(bg, 1) >= 4.5 || contrast(bg, 1) >= contrast(bg, luminance(NEAR_BLACK)) ? '#ffffff' : NEAR_BLACK
}

/** The CSS variables for a theme (missing colours fall back to the default). */
export function themeVariables(theme: ChurchTheme): Record<string, string> {
  const brand = theme.brand ?? DEFAULT_THEME.brand
  const brand2 = theme.brand2 ?? DEFAULT_THEME.brand2
  const { c, h } = oklchOf(brand)
  // brand-coloured text and rings sit on a dark page: keep them light enough to read
  const lift = (l: number) => `oklch(${l.toFixed(3)} ${Math.min(c, 0.2).toFixed(3)} ${h.toFixed(1)})`
  return {
    '--brand': brand,
    '--brand-2': brand2,
    '--brand-foreground': foregroundOn(brand),
    '--brand-hue': h.toFixed(1),
    '--highlight': lift(Math.max(oklchOf(brand).l, 0.8)),
    '--ring': lift(Math.max(oklchOf(brand).l, 0.7)),
  }
}
