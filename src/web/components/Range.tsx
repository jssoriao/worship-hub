import type { ComponentProps, CSSProperties } from 'react'
import { cn } from '@/lib/utils'
/**
 * A slim slider: a 4 px track filled up to the value and a small round handle (the `slim-range` utility in index.css).
 * The input itself stays tall, so a finger still hits it easily. Give it the height with a class (`h-8`).
 */
export function Range({ value, min = 0, max, className, style, ...props }: Omit<ComponentProps<'input'>, 'type' | 'value' | 'min' | 'max'> & { value: number; min?: number; max: number }) {
  const filled = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0
  return <input type="range" value={value} min={min} max={max} style={{ ...style, '--p': `${filled}%` } as CSSProperties} className={cn('slim-range', className)} {...props} />
}
