/**
 * The mix rules, as pure functions with no Web Audio in them. The engine turns the result into
 * gains and the UI uses it to show what is audible.
 *
 * A folder can hold one combined stem (the "parent", e.g. drums.mp3 in drums/) next to the parts
 * it was split into (kick, snare, ...). The parent is the parts added together, so they must
 * never play at the same time. The rule, in short:
 *
 *   - Parts untouched (none muted, none changed in volume, none soloed): the parent plays alone.
 *   - Any part muted, changed or soloed: the parent goes silent and the audible parts play.
 *   - Parent muted: the whole group is silent. Parent volume scales whichever source is playing.
 *
 * Parts are not in the first download (see lazyFlags); they follow in the background. If one is
 * needed before it has arrived, the parent keeps playing until it does. Once a group is being
 * edited and nothing is waiting on a download, its other parts are fetched too ("warm"). Mute
 * always wins, and any solo silences everything that is not soloed, exactly as for single stems.
 */

export interface MixState {
  muted: boolean
  solo: boolean
  volume: number // 0..1
}

/** What the mix rules need to know about each stem. */
export interface StemLayout {
  group: string
  /** the combined stem of its group */
  mix: boolean
}

interface Family {
  parent: number
  children: number[]
}

/** Groups that have a combined stem plus at least one part. Anything else is just single stems. */
export function families(layout: StemLayout[]): Family[] {
  const parents = new Map<string, number>()
  layout.forEach((l, i) => {
    if (l.mix && l.group && !parents.has(l.group)) parents.set(l.group, i)
  })
  const out: Family[] = []
  for (const [group, parent] of parents) {
    const children = layout.flatMap((l, i) => (l.group === group && i !== parent ? [i] : []))
    if (children.length > 0) out.push({ parent, children })
  }
  return out
}

/** Parts are left out of the first load so the song opens fast; the engine fetches them right after. */
export function lazyFlags(layout: StemLayout[]): boolean[] {
  const lazy = layout.map(() => false)
  for (const family of families(layout)) for (const c of family.children) lazy[c] = true
  return lazy
}

/**
 * Gain for every stem (0 = silent), the parts that must be downloaded before the mix can sound as
 * asked (`need`), and parts of groups being edited that are worth fetching once nothing is waiting
 * (`warm`). `loaded[i]` says whether stem i is ready to play.
 */
export function computeMix(
  layout: StemLayout[],
  mix: MixState[],
  loaded: boolean[],
): { gains: number[]; need: number[]; warm: number[] } {
  const gains = layout.map(() => 0)
  const need = new Set<number>()
  const warm = new Set<number>()
  const anySolo = mix.some((m) => m.solo)
  const grouped = new Set<number>()
  const fams = families(layout)
  for (const f of fams) {
    grouped.add(f.parent)
    for (const c of f.children) grouped.add(c)
  }

  // single stems: the plain mute / solo / volume rule
  layout.forEach((_, i) => {
    const m = mix[i]
    if (!grouped.has(i) && m && !m.muted && (!anySolo || m.solo)) gains[i] = m.volume
  })

  for (const { parent, children } of fams) {
    const pm = mix[parent]
    if (!pm) continue
    const soloed = children.filter((c) => mix[c]?.solo)
    const groupSolo = pm.solo || soloed.length > 0
    if (pm.muted || (anySolo && !groupSolo)) continue

    const untouched =
      soloed.length === 0 && children.every((c) => !mix[c] || (!mix[c].muted && mix[c].volume === 1))
    if (untouched) {
      gains[parent] = pm.volume
      continue
    }

    // only parts that can be heard are worth downloading
    const wanted = (soloed.length > 0 ? soloed : children).filter((c) => mix[c] && !mix[c].muted && mix[c].volume > 0)
    const missing = wanted.filter((c) => !loaded[c])
    if (missing.length > 0) {
      for (const c of missing) need.add(c)
      gains[parent] = pm.volume // keep the combined stem going until the parts have arrived
      continue
    }
    for (const c of wanted) gains[c] = mix[c].volume * pm.volume
    // the person is working in this group: its remaining parts are likely next
    for (const c of children) if (!loaded[c] && !wanted.includes(c)) warm.add(c)
  }

  return { gains, need: [...need], warm: [...warm] }
}
