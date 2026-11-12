/**
 * Which qualities a publish uploads and which ones the manifest then offers. Kept separate from
 * publish-songs.ts so the rules can be checked without touching R2.
 */
import { TIERS } from '../dev/songs-plugin.ts'

/** Names accepted by --tiers=..., besides the tier ids themselves. */
const ALIASES: Record<string, string> = {
  q4: 'standard',
  q6: 'saver',
  'data-saver': 'saver',
  datasaver: 'saver',
  orig: 'original',
}

/**
 * "standard,saver" -> ['standard', 'saver'] (in TIERS order). "all" or an empty list means every
 * tier. Throws with the accepted names on anything it does not know.
 */
export function parseTierList(arg: string | undefined): string[] {
  const names = (arg ?? '')
    .split(',')
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean)
  if (names.length === 0 || names.includes('all')) return TIERS.map((t) => t.id)
  const ids = new Set<string>()
  for (const name of names) {
    const id = ALIASES[name] ?? name
    if (!TIERS.some((t) => t.id === id)) {
      throw new Error(`Unknown quality "${name}". Use: ${TIERS.map((t) => t.id).join(', ')} (q4 = standard, q6 = saver), or "all".`)
    }
    ids.add(id)
  }
  return TIERS.filter((t) => ids.has(t.id)).map((t) => t.id)
}

/** The `tiers` of a manifest's JSON text; [] when it has none or the text is not a manifest. */
export function tiersFromManifest(text: string): { id: string; bytes?: number }[] {
  try {
    const tiers = (JSON.parse(text) as { tiers?: unknown } | null)?.tiers
    if (!Array.isArray(tiers)) return []
    return tiers.flatMap((t: { id?: unknown; bytes?: unknown } | null) =>
      typeof t?.id === 'string' && t.id ? [{ id: t.id, ...(typeof t.bytes === 'number' && t.bytes > 0 ? { bytes: t.bytes } : {}) }] : [],
    )
  } catch {
    return []
  }
}

/** Per file name (decoded) and quality: the `v` fingerprints in a manifest's JSON text. */
export function versionsFromManifest(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}
  try {
    const stems = (JSON.parse(text) as { stems?: unknown } | null)?.stems
    if (!Array.isArray(stems)) return out
    for (const s of stems as ({ file?: unknown; v?: unknown } | null)[]) {
      if (typeof s?.file !== 'string' || !s.v || typeof s.v !== 'object') continue
      let file: string = s.file
      try {
        file = decodeURIComponent(s.file)
      } catch {
        // keep it as written
      }
      for (const [tier, hash] of Object.entries(s.v)) {
        if (typeof hash === 'string' && /^[0-9a-f]{8,64}$/.test(hash)) (out[file] ??= {})[tier] = hash
      }
    }
  } catch {
    // not a manifest
  }
  return out
}

/**
 * Which fingerprint a file goes into the manifest with. A file uploaded now has the one just
 * measured. A file left as it was keeps the one the manifest already had, so its address (and every
 * copy saved under it) stays valid; failing that, the one recorded when it was uploaded; only if
 * there is none is one measured or computed from the local file.
 */
export function pickVersion(o: { uploadedNow: boolean; measured?: string; online?: string; recorded?: string; local?: string }): string | undefined {
  return o.uploadedNow ? (o.measured ?? o.local) : (o.online ?? o.recorded ?? o.measured ?? o.local)
}

export interface TierStatus {
  id: string
  /** every file of this quality is uploaded: just now, or recorded by an earlier publish */
  complete: boolean
  /** size measured in this run (only for qualities uploaded or checked now) */
  bytes?: number
  /** the entry the manifest in R2 already has for this quality, if any */
  remote?: { bytes?: number }
  /** size known without encoding (the original, or encodes that are cached) */
  known?: number
}

/**
 * The qualities the new manifest lists, which is what the app offers: everything uploaded now plus
 * everything that was already there. The manifest in R2 is the running record, so a publish of one
 * quality never hides another that is online. The app shows a switcher when this has two or more.
 */
export function offeredTiers(statuses: TierStatus[]): { id: string; bytes?: number }[] {
  return TIERS.flatMap((tier) => {
    const s = statuses.find((x) => x.id === tier.id)
    if (!s || !(s.complete || s.remote)) return []
    const bytes = s.bytes ?? s.remote?.bytes ?? s.known
    return [{ id: tier.id, ...(bytes ? { bytes } : {}) }]
  })
}
