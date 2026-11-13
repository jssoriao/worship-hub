import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { AuthScreen, EmailCodeSignIn, SignOutButton } from '../components/AuthGate'
import { ApiError, call, joinApi } from '../lib/api'
import { authClient } from '../lib/auth-client'

type Info = { church: string; role: string; singleUse: boolean }
type State = { kind: 'loading' } | { kind: 'ok'; info: Info } | { kind: 'problem'; title: string }

const roleName = (role: string) => role.charAt(0).toUpperCase() + role.slice(1)
const article = (role: string) => (/^[aeiou]/i.test(role) ? 'an' : 'a')

/**
 * /join/<token>: a link an admin made. The person sees which church and role, gives their email, signs
 * in with the emailed code, and is then in the church with that role. Someone already signed in only
 * confirms. Shown instead of the app (main.tsx), signed in or not.
 */
export function JoinPage({ token }: { token: string }) {
  // not even shaped like a link's secret: no need to ask the server
  const wellFormed = /^[0-9a-z]{32}$/.test(token)
  const [state, setState] = useState<State>(wellFormed ? { kind: 'loading' } : { kind: 'problem', title: "This join link doesn't work" })
  const { data: session, isPending } = authClient.useSession()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!wellFormed) return
    call(joinApi[':token'].$get({ param: { token } }))
      .then((info) => setState({ kind: 'ok', info }))
      .catch((e: unknown) =>
        setState({ kind: 'problem', title: e instanceof ApiError && (e.status === 404 || e.status === 410) ? e.message : "Couldn't open this link. Check your connection and try again." }),
      )
  }, [token, wellFormed])

  /** Joins (the person is signed in by now), makes that church the active one and opens the app. */
  const finish = async () => {
    try {
      const joined = await call(joinApi[':token'].finish.$post({ param: { token } }))
      await authClient.organization.setActive({ organizationId: joined.orgId })
      window.location.replace('/')
    } catch (e) {
      // the link stopped working between opening it and signing in: say why, as for any broken link
      if (e instanceof ApiError && (e.status === 404 || e.status === 410)) setState({ kind: 'problem', title: e.message })
      else throw e
    }
  }

  if (state.kind === 'loading' || isPending) {
    return (
      <AuthScreen>
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          Loading…
        </p>
      </AuthScreen>
    )
  }

  if (state.kind === 'problem') {
    return (
      <AuthScreen>
        <h2 className="mt-2 text-base font-semibold">{state.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">Ask the person who sent it for a new link.</p>
        <Button asChild variant="outline" className="mt-4 w-full">
          <a href="/">Go to Worship Hub</a>
        </Button>
      </AuthScreen>
    )
  }

  const { info } = state
  const heading = (
    <h2 className="mb-3 mt-1 text-base font-semibold">
      Join {info.church} as {article(info.role)} {roleName(info.role)}
    </h2>
  )

  if (session) {
    return (
      <AuthScreen>
        {heading}
        <p className="mb-4 text-sm text-muted-foreground">
          You're signed in as <span className="font-medium text-foreground">{session.user.email}</span>.
        </p>
        <Button
          size="lg"
          className="w-full"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            setError('')
            finish().catch((e: unknown) => {
              setBusy(false)
              setError(e instanceof Error ? e.message : String(e))
            })
          }}
        >
          {busy ? 'Joining…' : `Join ${info.church}`}
        </Button>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-300">
            {error}
          </p>
        )}
        <div className="mt-4 flex items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>Not you?</span>
          <SignOutButton redirect={location.pathname} />
        </div>
      </AuthScreen>
    )
  }

  return (
    <EmailCodeSignIn
      heading={heading}
      intro="Enter your email. We'll send you a code to sign in with."
      beforeSend={async (email) => {
        await call(joinApi[':token'].start.$post({ param: { token }, json: { email } }))
      }}
      onSignedIn={finish}
    />
  )
}
