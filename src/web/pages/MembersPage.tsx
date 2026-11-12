import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ROLE_NAMES, type Role } from '../../shared/permissions'
import { Alert } from '@/components/ui/alert'
import { PageHeader } from '../components/PageHeader'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { useChurch } from '../lib/church-context'
import { addMember, changeRole, listMembers, removeMember, type MemberList } from '../lib/members-api'

const label = (role: string) => role[0].toUpperCase() + role.slice(1)

/** Admins and owners: who is in this church, and what they may do. People sign in with an emailed code. */
export default function MembersPage() {
  const church = useChurch()
  const [list, setList] = useState<MemberList | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('member')
  const [confirming, setConfirming] = useState('')

  const load = useCallback(
    () =>
      listMembers().then(
        (l) => {
          setList(l)
          setError('')
        },
        (e: unknown) => setError(e instanceof Error ? e.message : 'Could not load members.'),
      ),
    [],
  )
  useEffect(() => {
    // a promise, so state is only set after the answer arrives
    void load()
  }, [load, church.id])

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await action()
      await load()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.')
      return false
    } finally {
      setBusy(false)
    }
  }

  const onAdd = async (e: FormEvent) => {
    e.preventDefault()
    if (await run(() => addMember({ email, name: name || undefined, role }))) {
      setEmail('')
      setName('')
    }
  }

  const manageable = list?.manageable ?? []
  const roleOptions = ROLE_NAMES.filter((r) => manageable.includes(r))

  return (
    <div className="mx-auto max-w-4xl px-4 pt-3 pb-24 md:px-6">
      <PageHeader title="Members" description={<>People in {church.name || 'this church'}. They sign in with a code sent to their email.</>} />

      {error && (
        <Alert variant="destructive" className="mt-4">
          {error}
        </Alert>
      )}

      {list && roleOptions.length > 0 && (
        <Card className="mt-5 p-3">
        <form onSubmit={onAdd} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
          <Label className="sr-only" htmlFor="member-email">
            Email
          </Label>
          <Input
            id="member-email"
            type="email"
            required
            autoComplete="off"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Label className="sr-only" htmlFor="member-name">
            Name (optional)
          </Label>
          <Input
            id="member-name"
            type="text"
            autoComplete="off"
            maxLength={80}
            placeholder="Name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Label className="sr-only" htmlFor="member-role">
            Role
          </Label>
          <NativeSelect wrapperClassName="w-full" id="member-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {roleOptions.map((r) => (
              <option key={r} value={r}>
                {label(r)}
              </option>
            ))}
          </NativeSelect>
          <Button type="submit" disabled={busy}>
            Add
          </Button>
        </form>
        </Card>
      )}

      {!list && !error && (
        <p role="status" className="mt-6 text-sm text-muted-foreground">
          Loading…
        </p>
      )}

      {list && (
        <Card className="mt-5 gap-0 py-0">
        <ul className="divide-y divide-border">
          {list.members.map((m) => {
            const mine = m.userId === list.me
            const editable = !mine && manageable.includes(m.role)
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {m.name}
                    {mine && <span className="ml-2 text-xs font-normal text-muted-foreground">You</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                </div>
                {editable ? (
                  <>
                    <Label className="sr-only" htmlFor={`role-${m.id}`}>
                      Role of {m.name}
                    </Label>
                    <NativeSelect
                      size="sm"
                      id={`role-${m.id}`}
                      value={m.role}
                      disabled={busy}
                      onChange={(e) => void run(() => changeRole(m.id, e.target.value as Role))}
                    >
                      {roleOptions.map((r) => (
                        <option key={r} value={r}>
                          {label(r)}
                        </option>
                      ))}
                    </NativeSelect>
                    {confirming === m.id ? (
                      <span className="flex gap-1.5">
                        <Button variant="destructive" size="sm" disabled={busy} onClick={() => void run(() => removeMember(m.id)).then(() => setConfirming(''))}>
                          Remove {m.name}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setConfirming('')}>
                          Cancel
                        </Button>
                      </span>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => setConfirming(m.id)}>
                        Remove
                      </Button>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">{label(m.role)}</span>
                )}
              </li>
            )
          })}
        </ul>
        </Card>
      )}
    </div>
  )
}
