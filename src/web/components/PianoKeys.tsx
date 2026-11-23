/**
 * A piano keyboard (88 keys, A0 to C8, by default) with the given notes lit, brighter the harder they are played.
 * `target` marks keys to press (a chord looked up) with a dot. Drawn as one SVG so it scales to its width; each C is
 * labelled with its octave (C4 is middle C). With `onPress`/`onRelease` the keys can be played with the mouse or a
 * finger: press a key, slide to the next, let go; each finger plays its own key. A sideways swipe still scrolls the
 * keyboard on a phone (it lets the key go).
 */
import { useRef, type PointerEvent } from 'react'
const BLACK = new Set([1, 3, 6, 8, 10])
const isBlack = (pitch: number) => BLACK.has(pitch % 12)
export function PianoKeys({
  active,
  target,
  from = 21,
  to = 108,
  onPress,
  onRelease,
}: {
  active: Map<number, number>
  target?: Set<number>
  from?: number
  to?: number
  onPress?: (pitch: number) => void
  onRelease?: (pitch: number) => void
}) {
  // the key each pointer (mouse, finger) holds
  const held = useRef(new Map<number, number>())
  const playable = !!onPress && !!onRelease
  // the key under a point: black keys are drawn on top, so the element there is the right one
  const keyAt = (e: PointerEvent<SVGSVGElement>) => {
    const el = document.elementFromPoint(e.clientX, e.clientY) as SVGElement | null
    const p = Number(el?.closest('[data-pitch]')?.getAttribute('data-pitch'))
    return Number.isFinite(p) && p > 0 ? p : null
  }
  const down = (e: PointerEvent<SVGSVGElement>) => {
    const p = keyAt(e)
    if (!playable || p === null || (e.pointerType === 'mouse' && e.button !== 0)) return
    e.currentTarget.setPointerCapture(e.pointerId)
    held.current.set(e.pointerId, p)
    onPress!(p)
  }
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const was = held.current.get(e.pointerId)
    if (was === undefined) return
    const p = keyAt(e)
    if (p === null || p === was) return
    onRelease!(was)
    held.current.set(e.pointerId, p)
    onPress!(p)
  }
  const up = (e: PointerEvent<SVGSVGElement>) => {
    const was = held.current.get(e.pointerId)
    if (was === undefined) return
    held.current.delete(e.pointerId)
    onRelease!(was)
  }
  const whites: number[] = []
  for (let p = from; p <= to; p++) if (!isBlack(p)) whites.push(p)
  const W = 10
  const H = 56
  const width = whites.length * W
  // a black key sits over the line between two white keys
  const x = (pitch: number) => (isBlack(pitch) ? whites.indexOf(pitch - 1) * W + W - 3 : whites.indexOf(pitch) * W)
  const lit = (pitch: number) => {
    const v = active.get(pitch)
    return v === undefined ? null : 0.55 + (v / 127) * 0.45
  }
  const names = [...active.keys()].sort((a, b) => a - b).map(noteLabel).join(' ')
  const wanted = [...(target ?? [])].sort((a, b) => a - b).map(noteLabel).join(' ')
  return (
    <svg viewBox={`0 0 ${width} ${H + 1}`} role="img" aria-label={`${names ? `Keys down: ${names}` : 'No keys down'}${wanted ? `. To press: ${wanted}` : ''}`}
       className={`block h-auto w-full select-none ${playable ? 'cursor-pointer touch-pan-x' : ''}`}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
    >
      {whites.map((p) => {
        const o = lit(p)
        return (
          <g key={p} data-pitch={p}>
            <rect x={x(p) + 0.25} y={0.5} width={W - 0.5} height={H} rx={1.2} className="fill-slate-100 stroke-slate-500" strokeWidth={0.4} />
            {o !== null && <rect x={x(p) + 0.25} y={0.5} width={W - 0.5} height={H} rx={1.2} className="fill-primary" fillOpacity={o} />}
            {target?.has(p) && <circle cx={x(p) + W / 2} cy={H - 12} r={2.4} className="fill-amber-500 stroke-amber-900" strokeWidth={0.4} />}
            {p % 12 === 0 && (
              <text x={x(p) + W / 2} y={H - 3} textAnchor="middle" className={o !== null ? 'fill-white' : 'fill-slate-500'} fontSize={4.2}>
                {noteLabel(p)}
              </text>
            )}
          </g>
        )
      })}
      {Array.from({ length: to - from + 1 }, (_, k) => from + k)
        .filter(isBlack)
        .map((p) => {
          const o = lit(p)
          return (
            <g key={p} data-pitch={p}>
              <rect x={x(p)} y={0.5} width={6} height={H * 0.62} rx={0.8} className="fill-slate-900" />
              {o !== null && <rect x={x(p)} y={0.5} width={6} height={H * 0.62} rx={0.8} className="fill-highlight" fillOpacity={o} />}
              {target?.has(p) && <circle cx={x(p) + 3} cy={H * 0.62 - 5} r={2.1} className="fill-amber-400 stroke-amber-900" strokeWidth={0.4} />}
            </g>
          )
        })}
    </svg>
  )
}
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
/** "C4" for MIDI note 60. */
const noteLabel = (pitch: number) => `${NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`
