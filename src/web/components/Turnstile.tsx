import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'

/**
 * Cloudflare Turnstile, the human check the server asks for before it sends a sign-in code (see
 * turnstileSecret in src/api/auth-options.ts). It is usually invisible ("interaction-only" shows a
 * checkbox only when Cloudflare is unsure). Each token works once, so the form asks for a new one
 * after every request (`reset`).
 */

/** The public site key. Production's comes from .env.production; elsewhere Cloudflare's test key, which always passes. */
const TURNSTILE_SITE_KEY = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || '1x00000000000000000000AA'
/** Must match CAPTCHA_ACTION in src/api/auth-options.ts. */
const ACTION = 'sign-in'
const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string
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
  /** Forget the current token and get a new one (after a token was used, or it failed). */
  reset: () => void
}

interface Props {
  /** A token is ready (string), or the current one ran out or failed (null). */
  onToken: (token: string | null) => void
  /** Turnstile could not run at all (blocked script, no connection). */
  onUnavailable: () => void
  ref?: Ref<TurnstileHandle>
}

export function Turnstile({ onToken, onUnavailable, ref }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const widget = useRef<string | null>(null)
  const api = useRef<TurnstileApi | null>(null)
  // the latest callbacks, without re-rendering the widget when they change
  const handlers = useRef({ onToken, onUnavailable })
  useEffect(() => {
    handlers.current = { onToken, onUnavailable }
  })

  useImperativeHandle(ref, () => ({
    reset: () => {
      handlers.current.onToken(null)
      if (api.current && widget.current) api.current.reset(widget.current)
    },
  }))

  useEffect(() => {
    let cancelled = false
    loadTurnstile()
      .then((t) => {
        if (cancelled || !box.current) return
        api.current = t
        widget.current = t.render(box.current, {
          sitekey: TURNSTILE_SITE_KEY,
          action: ACTION,
          theme: 'dark',
          appearance: 'interaction-only',
          callback: (token: string) => handlers.current.onToken(token),
          'expired-callback': () => handlers.current.onToken(null),
          'error-callback': () => {
            handlers.current.onToken(null)
            // let Turnstile retry by itself; the form shows why it waits
            return true
          },
        })
      })
      .catch(() => {
        if (!cancelled) handlers.current.onUnavailable()
      })
    return () => {
      cancelled = true
      if (api.current && widget.current) api.current.remove(widget.current)
      widget.current = null
    }
  }, [])

  // empty until Cloudflare needs the person to tick a box; then the widget appears here
  return <div ref={box} className="flex justify-center empty:hidden [&:has(iframe)]:mt-3" />
}
