import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { can, isRole } from '../../shared/permissions'
import { authClient } from './auth-client'
import { ChurchContext, pickChurch, type ChurchInfo, type ChurchValue } from './church-context'
import { SignOutButton } from '../components/AuthGate'

/** The church last used on this device, so a person in several churches isn't asked again. */
const LAST_KEY = 'worship-hub:church'
const lastChurch = () => {
  try {
    return localStorage.getItem(LAST_KEY) ?? ''
  } catch {
    return ''
  }
}
const rememberChurch = (id: string) => {
  try {
    localStorage.setItem(LAST_KEY, id)
  } catch {
    // storage blocked: just asked again next time
  }
}

function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-950 px-4 text-slate-100">
      <main className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h1 className="mb-2 text-lg font-semibold tracking-tight">Worship Hub</h1>
        {children}
      </main>
    </div>
  )
}

/**
 * Between sign-in and the app: makes sure one church is active for the session. Members of one church
 * go straight in; members of several land in the last one they used, or choose.
 */
function Gate({ children }: { children: ReactNode }) {
  const { data: session } = authClient.useSession()
  const orgs = authClient.useListOrganizations()
  const member = authClient.useActiveMember()
  const [failed, setFailed] = useState(false)

  const churches: ChurchInfo[] = useMemo(
    () => (orgs.data ?? []).map((o) => ({ id: o.id, name: o.name, slug: o.slug })),
    [orgs.data],
  )
  const activeId = (session?.session as { activeOrganizationId?: string | null } | undefined)?.activeOrganizationId ?? ''
  const active = churches.find((c) => c.id === activeId)

  const choose = useCallback(async (id: string) => {
    setFailed(false)
    const { error } = await authClient.organization.setActive({ organizationId: id })
    if (error) return setFailed(true)
    rememberChurch(id)
  }, [])

  // someone with no active church (a session from before churches existed) gets one, when the choice is clear
  const auto = !orgs.isPending && !active ? pickChurch(churches, lastChurch()) : null
  useEffect(() => {
    if (!auto) return
    void authClient.organization.setActive({ organizationId: auto }).then(({ error }) => {
      if (!error) rememberChurch(auto)
    })
  }, [auto])

  const switchTo = useCallback(
    async (id: string) => {
      await choose(id)
      // nothing of the old church stays open: a clean start at Practice
      window.location.replace('/practice')
    },
    [choose],
  )

  const role = member.data?.role
  const value: ChurchValue = useMemo(
    () => ({
      id: active?.id ?? '',
      name: active?.name ?? '',
      role: isRole(role) ? role : null,
      churches,
      can: (permission) => can(role, permission),
      switchTo,
    }),
    [active, role, churches, switchTo],
  )

  // installed app opened without a connection: songs saved on the device still open, under the church last used here
  if (orgs.error && !navigator.onLine) {
    const offline: ChurchValue = { id: lastChurch(), name: '', role: null, churches: [], can: () => false, switchTo: async () => {} }
    return <ChurchContext.Provider value={offline}>{children}</ChurchContext.Provider>
  }
  if (orgs.isPending) {
    return (
      <Screen>
        <p role="status" className="text-sm text-slate-400">
          Loading…
        </p>
      </Screen>
    )
  }
  if (churches.length === 0) {
    return (
      <Screen>
        <p role="status" className="mb-4 text-sm text-slate-300">
          You are not in a church yet. Ask your church admin to add you.
        </p>
        <SignOutButton />
      </Screen>
    )
  }
  if (!active && !auto) {
    return (
      <Screen>
        <p className="mb-3 text-sm text-slate-300">Which church?</p>
        <ul className="flex flex-col gap-2">
          {churches.map((c) => (
            <li key={c.id}>
              <button
                className="w-full rounded-xl border border-slate-700 px-3 py-2.5 text-left text-sm outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-teal-500"
                onClick={() => void choose(c.id)}
              >
                {c.name}
              </button>
            </li>
          ))}
        </ul>
        {failed && (
          <p role="alert" className="mt-3 rounded-lg bg-red-950 p-3 text-sm text-red-200">
            Could not open that church. Try again.
          </p>
        )}
      </Screen>
    )
  }
  if (!active) {
    return (
      <Screen>
        <p role="status" className="text-sm text-slate-400">
          Opening your church…
        </p>
      </Screen>
    )
  }
  return <ChurchContext.Provider value={value}>{children}</ChurchContext.Provider>
}

export function ChurchGate({ children }: { children: ReactNode }) {
  return <Gate>{children}</Gate>
}
