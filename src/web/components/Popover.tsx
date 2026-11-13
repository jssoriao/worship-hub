import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Popover as Root, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface Props {
  /** what the button says to screen readers (and on hover) */
  label: string
  /** the button's face */
  button: ReactNode
  /** heading of the panel */
  title: string
  children: ReactNode
  /** button style when its feature is on (the click, say) */
  active?: boolean
  className?: string
  /** which edge of the button the panel lines up with */
  align?: 'start' | 'center' | 'end'
}

/**
 * A play-bar button with a small panel above it. Radix handles focus, Escape, a tap outside and
 * keeping the panel on screen.
 */
export function Popover({ label, button, title, children, active = false, className, align = 'end' }: Props) {
  return (
    <Root>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          aria-label={label}
          title={label}
          className={cn('h-9 px-2.5 text-secondary-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground', active && 'text-highlight', className)}
        >
          {button}
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align={align} aria-label={title} className="w-72 p-3 text-sm">
        <p className="mb-2 font-medium">{title}</p>
        {children}
      </PopoverContent>
    </Root>
  )
}
