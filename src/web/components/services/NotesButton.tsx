import { useState } from 'react'
import { StickyNoteIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { Hint } from '../Hint'
import { useIsMobileLayout } from '../../lib/layout-context'
import { MobileSheet } from '../MobileSheet'

/** How long the notes of a service line may be (the API checks the same). */
export const LINE_NOTES_MAX = 4000

/**
 * The notes of a service line behind an icon: bright when there are some, and a hover shows the start of them. A
 * click opens them in a popover (a bottom sheet in the mobile layout); people who plan can write there, the
 * others read.
 */
export function NotesButton({ title, notes, editable, onChange, className }: { title: string; notes: string; editable: boolean; onChange: (notes: string) => void; className?: string }) {
  const mobile = useIsMobileLayout()
  const [open, setOpen] = useState(false)
  const has = notes.trim() !== ''
  // nothing to read: no button for people who cannot write
  if (!has && !editable) return null
  const label = has ? `Notes for ${title}` : `Add notes for ${title}`
  const preview = has ? (notes.length > 140 ? `${notes.slice(0, 140)}…` : notes) : 'Add notes'
  const body = <NotesBody notes={notes} editable={editable} onChange={onChange} label={label} />
  const button = (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={label} aria-haspopup="dialog" className={`${has ? 'text-highlight' : 'text-muted-foreground'} mobile:size-11 ${className ?? ''}`} onClick={mobile ? () => setOpen(true) : undefined}>
      <StickyNoteIcon aria-hidden="true" className={has ? 'fill-highlight/20' : ''} />
    </Button>
  )
  if (mobile) {
    return (
      <>
        {button}
        <MobileSheet open={open} onClose={() => setOpen(false)} title={title}>
          {body}
        </MobileSheet>
      </>
    )
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Hint text={open ? undefined : preview}>
        <PopoverTrigger asChild>{button}</PopoverTrigger>
      </Hint>
      <PopoverContent align="end" aria-label={label} className="w-96 p-3">
        <p className="mb-2 truncate text-sm font-medium">{title}</p>
        {body}
      </PopoverContent>
    </Popover>
  )
}

/** The notes themselves: a box to write in, or the text to read. Also the Songs tab's Notes view. */
export function NotesBody({ notes, editable, onChange, label, tall = false }: { notes: string; editable: boolean; onChange: (notes: string) => void; label: string; tall?: boolean }) {
  if (!editable) return <p className={`whitespace-pre-wrap break-words ${tall ? 'text-base leading-relaxed mobile:text-lg' : 'max-h-80 overflow-y-auto text-sm'}`}>{notes}</p>
  return (
    <Textarea
      autoFocus={!tall}
      aria-label={label}
      placeholder="Notes"
      maxLength={LINE_NOTES_MAX}
      value={notes}
      onChange={(e) => onChange(e.target.value)}
      className={tall ? 'min-h-[60dvh] resize-none text-base leading-relaxed' : 'min-h-40'}
    />
  )
}
