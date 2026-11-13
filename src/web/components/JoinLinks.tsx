import { useCallback, useEffect, useState } from 'react'
import { ROLE_NAMES, type Role } from '../../shared/permissions'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { createLink, listLinks, revokeLink, type LinkList } from '../lib/members-api'

const label = (role: string) => role[0].toUpperCase() + role.slice(1)
const KINDS = [
  ['single', 'One person · 3 days'],
  ['shared', 'Shared · 1 day'],
] as const

/** "in 3 days", "in 5 hours", "in 20 minutes" */
function expiresIn(iso: string): string {
  const minutes = Math.max(1, Math.round((Date.parse(iso) - Date.now()) / 60_000))
  if (minutes >= 60 * 24) return `in ${Math.round(minutes / (60 * 24))} day${minutes >= 60 * 36 ? 's' : ''}`
  if (minutes >= 60) return `in ${Math.round(minutes / 60)} hour${minutes >= 90 ? 's' : ''}`
  return `in ${minutes} minute${minutes === 1 ? '' : 's'}`
}

/**
 * Members page, for admins and owners: links that let people add themselves to the church with a role.
 * The person opens it, gives their email and signs in with the emailed code. A new link's address is
 * shown once, right after it is made (the server keeps only a hash of it).
 */
export function JoinLinks() {
  const [list, setList] = useState<LinkList | null>(null)
  const [kind, setKind] = useState<'single' | 'shared'>('single')
  const [role, setRole] = useState<Role>('member')
  const [made, setMade] = useState<{ url: string; copied: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(
    () =>
      listLinks().then(
        (l) => setList(l),
        (e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the links.'),
      ),
    [],
  )
  useEffect(() => {
    void load()
  }, [load])

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const create = () =>
    run(async () => {
      const { path } = await createLink({ role, singleUse: kind === 'single' })
      setMade({ url: `${location.origin}${path}`, copied: false })
    })

  const copy = async () => {
    if (!made) return
    try {
      await navigator.clipboard.writeText(made.url)
      setMade({ ...made, copied: true })
    } catch {
      setError("Couldn't copy. Select the link and copy it yourself.")
    }
  }

  const roleOptions = ROLE_NAMES.filter((r) => list?.roles.includes(r))
  if (list && roleOptions.length === 0) return null

  return (
    <Card className="mt-5 gap-0 p-3">
      <h2 className="text-sm font-semibold">Join links</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">Send a link instead of typing someone's email. They enter their own email and sign in with a code.</p>

      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
        <Label className="sr-only" htmlFor="link-kind">
          Who the link is for
        </Label>
        <NativeSelect wrapperClassName="w-full" id="link-kind" value={kind} onChange={(e) => setKind(e.target.value as 'single' | 'shared')}>
          {KINDS.map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
        </NativeSelect>
        <Label className="sr-only" htmlFor="link-role">
          Role
        </Label>
        <NativeSelect wrapperClassName="w-full" id="link-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {roleOptions.map((r) => (
            <option key={r} value={r}>
              {label(r)}
            </option>
          ))}
        </NativeSelect>
        <Button disabled={busy || !list} onClick={() => void create()}>
          Create link
        </Button>
      </div>

      {made && (
        <div className="mt-3 rounded-xl border border-input bg-background/50 p-3">
          <Label htmlFor="link-url" className="text-xs text-muted-foreground">
            Copy it now: it can't be shown again.
          </Label>
          <div className="mt-1.5 flex gap-2">
            <Input id="link-url" readOnly value={made.url} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
            <Button variant="outline" onClick={() => void copy()}>
              {made.copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {list && list.links.length > 0 && (
        <ul className="mt-3 divide-y divide-border border-t border-border">
          {list.links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  {l.singleUse ? 'One person' : 'Shared'} · {label(l.role)}
                  {!l.singleUse && l.uses > 0 && <span className="text-muted-foreground"> · {l.uses} joined</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  Expires {expiresIn(l.expiresAt)}
                  {l.createdBy && ` · made by ${l.createdBy}`}
                </p>
              </div>
              {list.roles.includes(l.role) && (
                <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(() => revokeLink(l.id).then(() => undefined))}>
                  Turn off
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
