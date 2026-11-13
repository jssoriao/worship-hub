import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'
import { TurnstileError } from '../lib/turnstile-error'

/**
 * Cloudflare Turnstile, the human check the server asks for before it sends a sign-in code (see
 * turnstileSecret in src/api/auth-options.ts). It runs only when asked (`token()`, on "Email me a
 * code" or "Send a new code"), and stays invisible unless Cloudflare wants a tick: then the box shows
 * here, full width, until it is solved. Each token works once, so every request gets a new one.
 */

/** The public site key. Production's comes from .env.production; elsewhere Cloudflare's test key, which always passes. */
const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || '1x00000000000000000000AA'
/** Must match CAPTCHA_ACTION in src/api/auth-options.ts. */
const ACTION = 'sign-in'
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string
  execute(id: string): void
  reset(id: string): void
  remove(id: string): void
}
declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let loading: Promise<TurnstileApi> | undefined
/** Loads Cloudflare's script once per page. */
function loadTurnstile(): Promise<TurnstileApi> {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile)
    const script = document.createElement('script')
    script.src = SCRIPT
    script.async = true
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile did not load')))
    script.onerror = () => {
      loading = undefined // try again next time
      reject(new Error('Turnstile did not load'))
    }
    document.head.appendChild(script)
  })
  return loading
}

export interface TurnstileHandle {
  /** Runs the check and resolves with a fresh, single-use token (showing the box only if Cloudflare asks). */
  token: () => Promise<string>
}

export function Turnstile({ ref }: { ref?: Ref<TurnstileHandle> }) {
  const box = useRef<HTMLDivElement>(null)
  const widget = useRef<string | null>(null)
  const api = useRef<Promise<TurnstileApi> | null>(null)
  // the request waiting for a token
  const pending = useRef<{ resolve: (t: string) => void; reject: (e: TurnstileError) => void } | null>(null)
  // Cloudflare wants the person to tick the box
  const [asking, setAsking] = useState(false)
  // the widget has run once (its token is then spent, so the next request resets it first)
  const ran = useRef(false)

  const settle = (token: string | null, unavailable = false) => {
    const p = pending.current
    pending.current = null
    setAsking(false)
    if (!p) return
    if (token) p.resolve(token)
    else p.reject(new TurnstileError(unavailable))
  }

  useEffect(() => {
    // this mount's own widget, so a cleanup never removes one rendered by a later mount
    let mine: string | null = null
    let cancelled = false
    api.current = loadTurnstile().then((t) => {
      if (!cancelled && box.current) {
        mine = t.render(box.current, {
          sitekey: TURNSTILE_SITE_KEY,
          action: ACTION,
          theme: 'dark',
          size: 'flexible',
          appearance: 'interaction-only',
          // nothing runs until a request asks for a token
          execution: 'execute',
          callback: (token: string) => settle(token),
          'expired-callback': () => settle(null),
          'error-callback': () => {
            settle(null)
            return true
          },
          'before-interactive-callback': () => setAsking(true),
          'after-interactive-callback': () => setAsking(false),
        })
        widget.current = mine
        ran.current = false
      }
      return t
    })
    api.current.catch(() => settle(null, true))
    return () => {
      cancelled = true
      void loadTurnstile()
        .then((t) => {
          if (mine) t.remove(mine)
          if (widget.current === mine) widget.current = null
        })
        .catch(() => {})
    }
  }, [])

  useImperativeHandle(ref, () => ({
    token: async () => {
      let t: TurnstileApi
      try {
        t = await api.current!
      } catch {
        throw new TurnstileError(true)
      }
      if (!widget.current) throw new TurnstileError(true)
      const id = widget.current
      // the last token was used (or never came): start a fresh check
      pending.current?.reject(new TurnstileError(false))
      const next = new Promise<string>((resolve, reject) => (pending.current = { resolve, reject }))
      // resetting a widget that never ran counts as a failure, so only reset after the first run
      try {
        if (ran.current) t.reset(id)
        ran.current = true
        t.execute(id)
      } catch {
        settle(null)
      }
      return next
    },
  }))

  // takes room only while Cloudflare shows its box
  return <div ref={box} className={asking ? 'mt-4' : 'h-0 overflow-hidden'} />
}
