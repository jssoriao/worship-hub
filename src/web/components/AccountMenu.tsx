import { useEffect, useId, useRef, useState } from 'react'
import { audioCache } from '../lib/audio-cache'
import { authClient } from '../lib/auth-client'
import { useChurch } from '../lib/church-context'

const initialOf = (text: string) => (text.trim()[0] ?? '?').toUpperCase()

/** The person's menu at the right end of the bar: who is signed in, their role here, and Sign out. */
export function AccountMenu() {
  const { data: session } = authClient.useSession()
  const church = useChurch()
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

  const name = session?.user.name ?? ''
  const email = session?.user.email ?? ''

  return (
    <div ref={box} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label="Account"
        title="Account"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex size-8 items-center justify-center rounded-full bg-slate-800 text-sm font-medium text-slate-100 outline-none hover:bg-slate-700 focus-visible:ring-2 focus-visible:ring-teal-400"
      >
        {initialOf(name || email)}
      </button>
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label="Account"
          className="absolute right-0 top-full z-40 mt-2 w-64 rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm shadow-xl shadow-black/60"
        >
          <p className="truncate font-medium text-slate-100">{name || email}</p>
          {name && <p className="truncate text-xs text-slate-400">{email}</p>}
          {church.role && <p className="mt-1 text-xs capitalize text-slate-400">{church.role}</p>}
          <button
            type="button"
            className="mt-3 w-full rounded-lg border border-slate-700 px-3 py-1.5 text-left text-sm outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-teal-400"
            // songs saved on this device are for members: they go when the person signs out
            onClick={() => void Promise.allSettled([authClient.signOut(), audioCache.clearAll()]).finally(() => window.location.replace('/'))}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
