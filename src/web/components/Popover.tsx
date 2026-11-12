import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

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
}

/**
 * A button with a small panel that opens above it, as in the play bar. Closes on Escape, a tap
 * outside, or the button again.
 */
export function Popover({ label, button, title, children, active = false, className = '' }: Props) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      trigger.current?.focus()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={box} className={`relative ${className}`}>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-teal-400 ${
          open ? 'bg-slate-800 text-white' : active ? 'text-teal-300 hover:bg-slate-800' : 'text-slate-300 hover:bg-slate-800'
        }`}
      >
        {button}
      </button>
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label={title}
          className="absolute bottom-full right-0 z-40 mb-2 w-72 rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm shadow-xl shadow-black/60"
        >
          <p className="mb-2 font-medium text-slate-100">{title}</p>
          {children}
        </div>
      )}
    </div>
  )
}
