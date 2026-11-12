import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useEffect, useRef, useState } from 'react'

interface Props {
  title: string
  initial: string
  placeholder?: string
  /** quick picks, e.g. the song's chords */
  suggestions?: string[]
  /** extra buttons (e.g. "No chord", "Remove") */
  actions?: { label: string; onClick: () => void }[]
  onSave: (value: string) => void
  onCancel: () => void
}

/** A small inline editor: a text field, quick picks, Save and Cancel. Enter saves, Esc cancels. */
export function EditPopover({ title, initial, placeholder, suggestions = [], actions = [], onSave, onCancel }: Props) {
  const [value, setValue] = useState(initial)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  return (
    <div role="dialog" aria-label={title} className="mt-1 rounded-xl border border-teal-700/60 bg-card p-2 shadow-xl shadow-black/50">
      <p className="mb-1 text-xs text-muted-foreground">{title}</p>
      <form
        className="flex flex-wrap items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          onSave(value)
        }}
      >
        <Input
          ref={input}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onCancel()}
          aria-label={title}
          className="h-8 w-auto flex-1"
        />
        <Button size="xs" type="submit">
          Save
        </Button>
        {actions.map((a) => (
          <Button variant="outline" size="xs" key={a.label} onClick={a.onClick}>
            {a.label}
          </Button>
        ))}
        <Button variant="outline" size="xs" onClick={onCancel}>
          Cancel
        </Button>
      </form>
      {suggestions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => onSave(s)} className="rounded-md bg-accent px-2 py-0.5 text-xs text-slate-200 outline-none hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-ring">
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
