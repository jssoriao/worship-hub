import { Button } from '@/components/ui/button'
import { useId, useState } from 'react'
interface Props {
  /** what is copied: "chords" or "lyrics" */
  what: string
  /** what it is copied between: "section" */
  noun: string
  options: { value: number; label: string }[]
  onCopy: (from: number) => void
  /** shown when there is nothing to copy from */
  emptyNote?: string
}
/** "Copy chords from" (or lyrics) a chosen other section, shown inside an edit box. */
export function CopyFrom({ what, noun, options, onCopy, emptyNote }: Props) {
  const id = useId()
  const [from, setFrom] = useState('')
  if (options.length === 0) return emptyNote ? <p className="mt-2 text-xs text-muted-foreground">{emptyNote}</p> : null
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        Copy {what} from another {noun}
      </label>
      <select
        id={id}
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="">Choose a {noun}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Button size="xs" disabled={from === ''} onClick={() => onCopy(Number(from))}>
        Copy
      </Button>
    </div>
  )
}
