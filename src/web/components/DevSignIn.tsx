import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { devApi, call } from '../lib/api'
type People = Awaited<ReturnType<typeof loadPeople>>
const loadPeople = () => call(devApi.people.$get())
const label = (role: string) => role[0].toUpperCase() + role.slice(1)
/**
 * Local development only (the sign-in screen shows it in `pnpm dev`): one button per church and role that signs in
 * as that role with no emailed code. Shows nothing when the Worker does not allow it (DEV_LOGIN, dev-login.ts).
 */
export function DevSignIn() {
  const [people, setPeople] = useState<People | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    loadPeople().then(setPeople, () => setPeople(null))
  }, [])
  if (!people || people.churches.length === 0) return null
  const signIn = async (churchId: string, role: string) => {
    setBusy(true)
    setError('')
    try {
      await call(devApi['sign-in'].$post({ json: { churchId, role } }))
      // the whole app starts again as that person
      location.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not sign in.')
      setBusy(false)
    }
  }
  return (
    <section aria-label="Sign in as (development)" className="mt-6 border-t border-dashed border-amber-400/40 pt-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.15em] text-amber-200/80">Sign in as (development)</p>
      <div className="space-y-2">
        {people.churches.map((church) => (
          <div key={church.id}>
            <p className="mb-1 truncate text-xs text-muted-foreground">{church.name}</p>
            <div className="flex flex-wrap gap-1.5">
              {people.roles.map((role) => {
                const who = church.people[role]
                return (
                  // no Hint here: the sign-in screen is outside the app's tooltip provider
                  <Button
                    key={role}
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    aria-label={`${label(role)}: ${who ? who.name : `a new test ${role}`}`}
                    onClick={() => void signIn(church.id, role)}
                  >
                    {label(role)}
                    {!who && <span className="text-[10px] text-muted-foreground">new</span>}
                  </Button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
    </section>
  )
}
