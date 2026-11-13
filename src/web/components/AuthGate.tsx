import { useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { audioCache } from '../lib/audio-cache'
import { authClient } from '../lib/auth-client'
import { TurnstileError } from '../lib/turnstile-error'
import { Turnstile, type TurnstileHandle } from './Turnstile'

const CODE_LENGTH = 6
// Must match CODE_MINUTES in src/api/auth-options.ts
const CODE_MINUTES = 10

/** The centered card the screens before the app use (sign-in, choosing a church). */
export function AuthScreen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center px-4 text-foreground">
      <main className="w-full max-w-sm">
        <Card className="gap-0 p-5">
          <h1 className="mb-1 text-lg font-semibold tracking-tight">Worship Hub</h1>
          {children}
        </Card>
      </main>
    </div>
  )
}


function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <Alert variant="destructive" className="mt-3">
      {children}
    </Alert>
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
  // asking for a code: first the human check (Turnstile, a fresh token each time), then the request
  const [sending, setSending] = useState<'check' | 'send' | null>(null)
  const check = useRef<TurnstileHandle>(null)

  const requestCode = async () => {
    if (!check.current) return
    setBusy(true)
    setError(null)
    setSending('check')
    let token: string
    try {
      token = await check.current.token()
    } catch (e) {
      setBusy(false)
      setSending(null)
      setError(
        e instanceof TurnstileError && e.unavailable
          ? "The security check couldn't load. Check your connection, or allow challenges.cloudflare.com if a content blocker is on, then reload."
          : "The security check didn't pass. Try again.",
      )
      return
    }
    setSending('send')
    const { error: failure } = await authClient.emailOtp.sendVerificationOtp({ email: email.trim(), type: 'sign-in' }, { headers: { 'x-captcha-response': token } })
    setBusy(false)
    setSending(null)
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
        : failure.status === 400 || failure.status === 403
          ? "The security check didn't pass. Try again in a moment."
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

  // one human check for both steps: it shows its box only while Cloudflare asks for a tick
  const human = <Turnstile ref={check} />
  if (codeSent) {
    return (
      <AuthScreen>
        <p role="status" className="mb-4 text-sm text-slate-300">
          If <span className="font-medium text-foreground">{email.trim()}</span> is on the team list, a {CODE_LENGTH}-digit code is on its
          way. It works once and expires in {CODE_MINUTES} minutes. Check your spam folder if you don't see it.
        </p>
        <form onSubmit={submitCode}>
          <Label htmlFor="code" className="mb-1.5">
            Sign-in code
          </Label>
          <Input
            id="code"
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern={`[0-9]{${CODE_LENGTH}}`}
            maxLength={CODE_LENGTH}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
            className="h-11 text-center font-mono text-lg tracking-[0.5em] md:text-lg"
          />
          <Button type="submit" size="lg" disabled={busy || code.length !== CODE_LENGTH} className="mt-3 w-full">
            {busy && !sending ? 'Signing in…' : 'Sign in'}
          </Button>
          {error && <ErrorNote>{error}</ErrorNote>}
        </form>
        <div className="mt-4 flex justify-between text-sm">
          <Button variant="link" className="h-auto p-0 text-highlight" disabled={busy} onClick={() => void requestCode()}>
            {sending === 'check' ? 'Checking…' : sending === 'send' ? 'Sending…' : 'Send a new code'}
          </Button>
          <Button
            variant="link"
            className="h-auto p-0 text-highlight"
            onClick={() => {
              savePending(null)
              setCodeSent(false)
              setError(null)
            }}
          >
            Use a different email
          </Button>
        </div>
        {human}
      </AuthScreen>
    )
  }

  return (
    <AuthScreen>
      <p className="mb-4 text-sm text-muted-foreground">Sign in with the email address the team list has for you.</p>
      <form onSubmit={submitEmail}>
        <Label htmlFor="email" className="mb-1.5">
          Email
        </Label>
        <Input
          id="email"
          type="email"
          required
          autoComplete="email"
          inputMode="email"
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-11"
        />
        <Button type="submit" size="lg" disabled={busy || email.trim() === ''} className="mt-3 w-full">
          {sending === 'check' ? 'Checking you are not a bot…' : sending === 'send' ? 'Sending…' : 'Email me a code'}
        </Button>
        {human}
        {error && <ErrorNote>{error}</ErrorNote>}
      </form>
    </AuthScreen>
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
      <AuthScreen>
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          Loading…
        </p>
      </AuthScreen>
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
    <Button
      variant="outline"
      // songs saved on this device are for members: they go when the person signs out
      onClick={() => void Promise.allSettled([authClient.signOut(), audioCache.clearAll()]).finally(() => window.location.replace('/'))}
    >
      Sign out
    </Button>
  )
}
