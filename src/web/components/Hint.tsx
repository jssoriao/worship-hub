import type { ReactElement } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
/**
 * The one way to explain a control: a small label that shows when the pointer rests on it (or it has the keyboard
 * focus) and takes no room on the page. It never shows on a touch screen, which has no hover: there the control's own
 * icon and label must be enough (and the mobile layout gets a small "i" where an explanation really matters).
 * The child must be the control itself (a button, a link, a label); give an icon-only control an `aria-label` too.
 * A disabled control gets its hint as well (a disabled button receives no pointer events, so its wrapper does).
 */
export function Hint({ text, children, side = 'top' }: { text: string; children: ReactElement<{ disabled?: boolean }>; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  const disabled = children.props.disabled === true
  return (
    <Tooltip delayDuration={450}>
      <TooltipTrigger asChild>
        {disabled ? (
          <span tabIndex={0} className="inline-flex outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {children}
          </span>
        ) : (
          children
        )}
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-64">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}
