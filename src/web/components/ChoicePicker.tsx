import { useState, type ComponentProps, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { sameName } from '../../shared/assignments'
import { useIsMobileLayout } from '../lib/layout-context'
import { MobileSheet } from './MobileSheet'

export interface Choice {
  id: string
  label: string
}
interface Props {
  /** the heading of the sheet, and what a screen reader calls the picker */
  title: string
  placeholder: string
  choices: Choice[]
  onChoose: (choice: Choice) => void
  /** lets the person type something that is not in the list; it is offered as an "Add ..." row */
  onFree?: (text: string) => void
  /** the button that opens it: its face, its label for screen readers, and how it looks */
  trigger: ReactNode
  triggerLabel: string
  variant?: ComponentProps<typeof Button>['variant']
  size?: ComponentProps<typeof Button>['size']
  className?: string
}
/**
 * Pick one of a list (type to narrow it), or type something new. A popover on desktop and a bottom sheet in the
 * mobile layout, with the same contents. Used for the assignments of a service and for the people in them.
 */
export function ChoicePicker({ title, placeholder, choices, onChoose, onFree, trigger, triggerLabel, variant = 'outline', size = 'sm', className }: Props) {
  const mobile = useIsMobileLayout()
  const [open, setOpen] = useState(false)
  const done = () => setOpen(false)
  const list = (
    <ChoiceList
      title={title}
      placeholder={placeholder}
      choices={choices}
      onChoose={(c) => {
        onChoose(c)
        done()
      }}
      onFree={
        onFree &&
        ((text) => {
          onFree(text)
          done()
        })
      }
    />
  )
  if (mobile) {
    return (
      <>
        <Button type="button" variant={variant} size={size} aria-label={triggerLabel} aria-haspopup="dialog" className={className} onClick={() => setOpen(true)}>
          {trigger}
        </Button>
        <MobileSheet open={open} onClose={done} title={title}>
          {list}
        </MobileSheet>
      </>
    )
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant={variant} size={size} aria-label={triggerLabel} className={className}>
          {trigger}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" aria-label={title} className="w-72 p-2">
        {list}
      </PopoverContent>
    </Popover>
  )
}

function ChoiceList({ title, placeholder, choices, onChoose, onFree }: Pick<Props, 'title' | 'placeholder' | 'choices' | 'onChoose' | 'onFree'>) {
  const [text, setText] = useState('')
  const query = text.trim().toLowerCase()
  const shown = query ? choices.filter((c) => c.label.toLowerCase().includes(query)) : choices
  // what was typed is offered as new unless it is one of the choices already
  const free = onFree && text.trim() !== '' && !choices.some((c) => sameName(c.label, text))
  const row = 'flex min-h-9 w-full items-center rounded-md px-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent mobile:min-h-12 mobile:text-base'
  return (
    <div className="grid gap-2">
      <Input
        autoFocus
        aria-label={title}
        placeholder={placeholder}
        maxLength={120}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          // Enter takes the first match, else what was typed
          if (shown[0]) onChoose(shown[0])
          else if (free) onFree(text.trim())
        }}
        className="h-9 mobile:h-11"
      />
      <ul className="max-h-64 overflow-y-auto">
        {shown.map((c) => (
          <li key={c.id}>
            <button type="button" className={row} onClick={() => onChoose(c)}>
              <span className="truncate">{c.label}</span>
            </button>
          </li>
        ))}
        {free && (
          <li>
            <button type="button" className={`${row} text-highlight`} onClick={() => onFree(text.trim())}>
              <span className="truncate">Add “{text.trim()}”</span>
            </button>
          </li>
        )}
        {shown.length === 0 && !free && <li className="px-2 py-2 text-sm text-muted-foreground">Nothing to pick.</li>}
      </ul>
    </div>
  )
}
