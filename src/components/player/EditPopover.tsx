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
  const btn = 'rounded-lg border border-slate-600 px-2.5 py-1 text-xs outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-teal-400'
  return (
    <div role="dialog" aria-label={title} className="mt-1 rounded-xl border border-teal-700/60 bg-slate-900 p-2 shadow-xl shadow-black/50">
      <p className="mb-1 text-xs text-slate-400">{title}</p>
      <form
        className="flex flex-wrap items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          onSave(value)
        }}
      >
        <input
          ref={input}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onCancel()}
          aria-label={title}
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
        />
        <button type="submit" className={`${btn} border-teal-500 text-teal-200`}>
          Save
        </button>
        {actions.map((a) => (
          <button key={a.label} type="button" onClick={a.onClick} className={btn}>
            {a.label}
          </button>
        ))}
        <button type="button" onClick={onCancel} className={btn}>
          Cancel
        </button>
      </form>
      {suggestions.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {suggestions.map((s) => (
            <button key={s} type="button" onClick={() => onSave(s)} className="rounded-md bg-slate-800 px-2 py-0.5 text-xs text-slate-200 outline-none hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-teal-400">
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
