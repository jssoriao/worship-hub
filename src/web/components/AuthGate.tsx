import { useState, type FormEvent, type ReactNode } from 'react'
import { audioCache } from '../lib/audio-cache'
import { authClient } from '../lib/auth-client'

const CODE_LENGTH = 6
// Must match CODE_MINUTES in worker/auth-options.ts
const CODE_MINUTES = 10

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-950 px-4 text-slate-100">
      <main className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h1 className="mb-1 text-lg font-semibold tracking-tight">Worship Hub</h1>
        {children}
      </main>
    </div>
  )
}

const inputClass =
  'w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-teal-500'
const primaryButtonClass =
  'mt-3 w-full rounded-full bg-teal-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50'

function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-3 rounded-lg bg-red-950 p-3 text-sm text-red-200">
      {children}
    </p>
  )
}

/**
 * The step after "code sent" survives a reload. Phones often discard a background tab while the person
 * is in their mail app, which would otherwise drop them back at the email step. Only the address and
 * the send time are kept (per tab, never the code), and only for as long as a code is valid.
 */
const PENDING_KEY = 'worship-hub:pending-sign-in'

function loadPending(): string | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null') as { email?: string; sentAt?: number } | null
    if (saved?.email && saved.sentAt && Date.now() - saved.sentAt < CODE_MINUTES * 60_000) return saved.email
  } catch {
    // unreadable or blocked storage: start at the email step
  }
  return null
}

function savePending(email: string | null) {
  try {
    if (email) sessionStorage.setItem(PENDING_KEY, JSON.stringify({ email, sentAt: Date.now() }))
    else sessionStorage.removeItem(PENDING_KEY)
  } catch {
    // storage unavailable (private mode quotas): the in-memory state still works
  }
}

function LoginScreen() {
  const [pending] = useState(loadPending)
  const [email, setEmail] = useState(pending ?? '')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(pending !== null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const requestCode = async () => {
    setBusy(true)
    setError(null)
    const { error: failure } = await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: 'sign-in' })
    setBusy(false)
    if (!failure) {
      setCode('')
      setCodeSent(true)
      savePending(email.trim())
      return
    }
    // The server answers the same for members and strangers, so any failure here is about the request itself
    setError(
      failure.status === 429
        ? 'Too many attempts. Wait a minute and try again.'
        : "Couldn't send the code. Check the address and your connection, then try again.",
    )
  }

  const submitEmail = (e: FormEvent) => {
    e.preventDefault()
    void requestCode()
  }

  const submitCode = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error: failure } = await authClient.signIn.emailOtp({ email: email.trim(), otp: code })
    if (!failure) {
      savePending(null)
      window.location.replace('/')
      return
    }
    setBusy(false)
    setCode('')
    setError(
      failure.status === 429
        ? 'Too many attempts. Wait a minute and try again.'
        : 'That code is wrong, expired, or already used. Check it, or send a new code.',
    )
  }

  if (codeSent) {
    return (
      <Shell>
        <p role="status" className="mb-4 text-sm text-slate-300">
          If <span className="font-medium text-slate-100">{email.trim()}</span> is on the team list, a {CODE_LENGTH}-digit code is on its
          way. It works once and expires in {CODE_MINUTES} minutes. Check your spam folder if you don't see it.
        </p>
        <form onSubmit={submitCode}>
          <label htmlFor="code" className="mb-1 block text-sm font-medium">
            Sign-in code
          </label>
          <input
            id="code"
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern={`[0-9]{${CODE_LENGTH}}`}
            maxLength={CODE_LENGTH}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
            className={`${inputClass} text-center font-mono text-lg tracking-[0.5em]`}
          />
          <button type="submit" disabled={busy || code.length !== CODE_LENGTH} className={primaryButtonClass}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          {error && <ErrorNote>{error}</ErrorNote>}
        </form>
        <div className="mt-4 flex justify-between text-sm">
          <button className="text-teal-400 underline disabled:opacity-50" disabled={busy} onClick={() => void requestCode()}>
            Send a new code
          </button>
          <button
            className="text-teal-400 underline"
            onClick={() => {
              savePending(null)
              setCodeSent(false)
              setError(null)
            }}
          >
            Use a different email
          </button>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <p className="mb-4 text-sm text-slate-400">Sign in with the email address the team list has for you.</p>
      <form onSubmit={submitEmail}>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputClass}
        />
        <button type="submit" disabled={busy || email.trim() === ''} className={primaryButtonClass}>
          {busy ? 'Sending…' : 'Email me a code'}
        </button>
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </Shell>
  )
}

function Gate({ children }: { children: ReactNode }) {
  const { data: session, isPending, error } = authClient.useSession()
  // useSession refetches when the tab regains focus. Showing the loading screen then would unmount
  // the login form mid-sign-in, so it is only shown until the first answer arrives.
  const [checked, setChecked] = useState(false)
  if (!isPending && !checked) setChecked(true)

  if (!checked) {
    return (
      <Shell>
        <p role="status" className="mt-3 text-sm text-slate-400">
          Loading…
        </p>
      </Shell>
    )
  }
  if (session) return children
  // Installed app opened without a connection: let zip mode work, the song library needs the network anyway
  if (error && !navigator.onLine) return children
  return <LoginScreen />
}

export function AuthGate({ children }: { children: ReactNode }) {
  return <Gate>{children}</Gate>
}

/** For screens outside the app shell (no church yet); inside the app, sign-out is in the account menu. */
export function SignOutButton() {
  return (
    <button
      className="rounded-full border border-slate-700 px-3 py-1.5 text-sm"
      // songs saved on this device are for members: they go when the person signs out
      onClick={() => void Promise.allSettled([authClient.signOut(), audioCache.clearAll()]).finally(() => window.location.replace('/'))}
    >
      Sign out
    </button>
  )
}
