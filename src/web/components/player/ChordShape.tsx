import { guitarShape, noteName, parseChord, STRING_NAMES } from '../../lib/chord-shapes'

export type Instrument = 'guitar' | 'piano'

/** A chord's guitar diagram or piano keys, on a light card, with its name above. */
export function ChordShape({ name, instrument, size = 'md', dim = false }: { name: string; instrument: Instrument; size?: 'sm' | 'md'; dim?: boolean }) {
  const w = size === 'sm' ? 'w-24' : 'w-32 sm:w-36'
  return (
    <figure className={`flex flex-col items-center gap-1 ${dim ? 'opacity-60' : ''}`}>
      <figcaption className={`font-semibold tracking-tight text-foreground ${size === 'sm' ? 'text-lg' : 'text-2xl sm:text-3xl'}`}>{name}</figcaption>
      <div className={`${w} rounded-xl bg-slate-100 p-2 text-slate-900 shadow-lg shadow-black/40`}>
        {instrument === 'guitar' ? <Guitar name={name} /> : <Piano name={name} />}
      </div>
    </figure>
  )
}

function Guitar({ name }: { name: string }) {
  const shape = guitarShape(name)
  if (!shape) return <p className="py-8 text-center text-xs text-muted-foreground">No shape</p>
  const W = 100
  const H = 120
  const x0 = 14
  const x1 = 86
  const y0 = 22
  const fretH = 18
  const sx = (s: number) => x0 + ((x1 - x0) / 5) * s
  const frets = 5
  const label = (s: number) => (shape.frets[s] < 0 ? '×' : shape.frets[s] === 0 ? '○' : '')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${name} on guitar: ${shape.frets.map((f) => (f < 0 ? 'x' : f)).join(' ')}`} className="block h-auto w-full">
      {shape.baseFret > 1 && (
        <text x={4} y={y0 + fretH / 2 + 3} fontSize={9} fontWeight={700} fill="currentColor">
          {shape.baseFret}
        </text>
      )}
      {/* nut, or a thin top line higher up the neck */}
      <line x1={x0} x2={x1} y1={y0} y2={y0} stroke="currentColor" strokeWidth={shape.baseFret === 1 ? 3 : 1} />
      {Array.from({ length: frets }, (_, i) => (
        <line key={i} x1={x0} x2={x1} y1={y0 + fretH * (i + 1)} y2={y0 + fretH * (i + 1)} stroke="currentColor" strokeWidth={0.8} opacity={0.6} />
      ))}
      {STRING_NAMES.map((_, s) => (
        <line key={s} x1={sx(s)} x2={sx(s)} y1={y0} y2={y0 + fretH * frets} stroke="currentColor" strokeWidth={0.8} opacity={0.7} />
      ))}
      {STRING_NAMES.map((n, s) => (
        <g key={`l${s}`}>
          <text x={sx(s)} y={y0 - 6} fontSize={9} textAnchor="middle" fill="currentColor">
            {label(s)}
          </text>
          <text x={sx(s)} y={H - 2} fontSize={7} textAnchor="middle" fill="currentColor" opacity={0.7}>
            {n}
          </text>
        </g>
      ))}
      {shape.barre && (
        <rect
          x={sx(shape.barre.from) - 5}
          y={y0 + fretH * (shape.barre.fret - shape.baseFret) + fretH / 2 - 5}
          width={sx(shape.barre.to) - sx(shape.barre.from) + 10}
          height={10}
          rx={5}
          fill="#1e293b"
        />
      )}
      {shape.frets.map((f, s) =>
        f > 0 ? (
          <g key={`d${s}`}>
            <circle cx={sx(s)} cy={y0 + fretH * (f - shape.baseFret) + fretH / 2} r={6} fill="#1e293b" />
            {shape.fingers[s] > 0 && (
              <text x={sx(s)} y={y0 + fretH * (f - shape.baseFret) + fretH / 2 + 3} fontSize={8} fontWeight={700} textAnchor="middle" fill="white">
                {shape.fingers[s]}
              </text>
            )}
          </g>
        ) : null,
      )}
    </svg>
  )
}

/** Two octaves: the bass note in the left one, the chord in the right one. */
function Piano({ name }: { name: string }) {
  const chord = parseChord(name)
  if (!chord) return <p className="py-8 text-center text-xs text-muted-foreground">No notes</p>
  const lit = new Set<number>([chord.bass, ...chord.notes.map((n) => 12 + n)])
  const WHITE = [0, 2, 4, 5, 7, 9, 11]
  const BLACK: [number, number][] = [
    [1, 1],
    [3, 2],
    [6, 4],
    [8, 5],
    [10, 6],
  ]
  const ww = 100 / 14
  const keys = [0, 12]
  return (
    <svg viewBox="0 0 100 52" role="img" aria-label={`${name} on piano: ${noteName(chord.bass, chord.flats)} in the bass, ${chord.notes.map((n) => noteName(n, chord.flats)).join(' ')}`} className="block h-auto w-full">
      {keys.flatMap((oct, o) =>
        WHITE.map((pc, i) => (
          <rect key={`w${o}${pc}`} x={(o * 7 + i) * ww} y={0} width={ww - 0.6} height={40} rx={1} fill={lit.has(oct + pc) ? '#14b8a6' : 'white'} stroke="#94a3b8" strokeWidth={0.4} />
        )),
      )}
      {keys.flatMap((oct, o) =>
        BLACK.map(([pc, after]) => (
          <rect key={`b${o}${pc}`} x={(o * 7 + after) * ww - ww * 0.3} y={0} width={ww * 0.6} height={25} rx={0.8} fill={lit.has(oct + pc) ? '#0d9488' : '#1e293b'} />
        )),
      )}
      <text x={25} y={50} fontSize={6} textAnchor="middle" fill="#475569">
        {noteName(chord.bass, chord.flats)}
      </text>
      <text x={75} y={50} fontSize={6} textAnchor="middle" fill="#475569">
        {chord.notes.map((n) => noteName(n, chord.flats)).join(' ')}
      </text>
    </svg>
  )
}
