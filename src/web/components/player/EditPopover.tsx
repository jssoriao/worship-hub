import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useEffect, useRef, useState, type ReactNode } from 'react'

interface Props {
  title: string
  initial: string
  placeholder?: string
  /** quick picks, e.g. the song's chords */
  suggestions?: string[]
  /** extra buttons (e.g. "Remove") */
  actions?: { label: string; onClick: () => void }[]
  onSave: (value: string) => void
  onCancel: () => void
  /** more controls under the buttons */
  children?: ReactNode
  /** only the extra controls: no text field or Save */
  hideField?: boolean
}

/** A small inline editor: a text field, quick picks and Save. Enter saves; Esc or a tap outside closes it without saving. */
export function EditPopover({ title, initial, placeholder, suggestions = [], actions = [], onSave, onCancel, children, hideField = false }: Props) {
  const [value, setValue] = useState(initial)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  // Esc closes this box wherever the focus is (a quick pick, a button), and only this box
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  // a tap or click outside closes it too (nothing is saved)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !box.current?.contains(e.target)) onCancel()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [onCancel])
  return (
    <div ref={box} role="dialog" aria-label={title} className="mt-1 rounded-xl border border-primary/40 bg-card p-2 shadow-xl shadow-black/50">
      <p className="mb-1 text-xs text-muted-foreground">{title}</p>
      {!hideField && (
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
      </form>
      )}
      {!hideField && suggestions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => onSave(s)} className="rounded-md bg-accent px-2 py-0.5 text-xs text-slate-200 outline-none hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-ring">
              {s}
            </button>
          ))}
        </div>
      )}
      {children}
    </div>
  )
}
