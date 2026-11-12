import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { can, isRole } from '../../shared/permissions'
import { authClient } from './auth-client'
import { ChurchContext, pickChurch, type ChurchInfo, type ChurchValue } from './church-context'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { AuthScreen, SignOutButton } from '../components/AuthGate'

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
      <AuthScreen>
        <p role="status" className="text-sm text-muted-foreground">
          Loading…
        </p>
      </AuthScreen>
    )
  }
  if (churches.length === 0) {
    return (
      <AuthScreen>
        <p role="status" className="mb-4 text-sm text-slate-300">
          You are not in a church yet. Ask your church admin to add you.
        </p>
        <SignOutButton />
      </AuthScreen>
    )
  }
  if (!active && !auto) {
    return (
      <AuthScreen>
        <p className="mb-3 text-sm text-slate-300">Which church?</p>
        <ul className="flex flex-col gap-2">
          {churches.map((c) => (
            <li key={c.id}>
              <Button variant="outline" size="lg" className="w-full justify-start" onClick={() => void choose(c.id)}>
                {c.name}
              </Button>
            </li>
          ))}
        </ul>
        {failed && (
          <Alert variant="destructive" className="mt-3">
            Could not open that church. Try again.
          </Alert>
        )}
      </AuthScreen>
    )
  }
  if (!active) {
    return (
      <AuthScreen>
        <p role="status" className="text-sm text-muted-foreground">
          Opening your church…
        </p>
      </AuthScreen>
    )
  }
  return <ChurchContext.Provider value={value}>{children}</ChurchContext.Provider>
}

export function ChurchGate({ children }: { children: ReactNode }) {
  return <Gate>{children}</Gate>
}
