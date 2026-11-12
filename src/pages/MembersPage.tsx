import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ROLE_NAMES, type Role } from '../../shared/permissions'
import { Select } from '../components/Select'
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
    <div className="mx-auto max-w-3xl px-3 pb-24 pt-6">
      <h1 className="text-xl font-semibold tracking-tight">Members</h1>
      <p className="mt-1 text-sm text-slate-400">People in {church.name || 'this church'}. They sign in with a code sent to their email.</p>

      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-red-950 p-3 text-sm text-red-200">
          {error}
        </p>
      )}

      {list && roleOptions.length > 0 && (
        <form onSubmit={onAdd} className="mt-5 grid gap-2 rounded-xl border border-slate-800 bg-slate-900 p-3 sm:grid-cols-[1fr_1fr_auto_auto]">
          <label className="sr-only" htmlFor="member-email">
            Email
          </label>
          <input
            id="member-email"
            type="email"
            required
            autoComplete="off"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
          />
          <label className="sr-only" htmlFor="member-name">
            Name (optional)
          </label>
          <input
            id="member-name"
            type="text"
            autoComplete="off"
            maxLength={80}
            placeholder="Name (optional)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-teal-400"
          />
          <label className="sr-only" htmlFor="member-role">
            Role
          </label>
          <Select id="member-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {roleOptions.map((r) => (
              <option key={r} value={r}>
                {label(r)}
              </option>
            ))}
          </Select>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white outline-none hover:bg-teal-500 focus-visible:ring-2 focus-visible:ring-teal-300 disabled:opacity-50"
          >
            Add
          </button>
        </form>
      )}

      {!list && !error && (
        <p role="status" className="mt-6 text-sm text-slate-400">
          Loading…
        </p>
      )}

      {list && (
        <ul className="mt-5 divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900">
          {list.members.map((m) => {
            const mine = m.userId === list.me
            const editable = !mine && manageable.includes(m.role)
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {m.name}
                    {mine && <span className="ml-2 text-xs font-normal text-slate-400">You</span>}
                  </p>
                  <p className="truncate text-xs text-slate-400">{m.email}</p>
                </div>
                {editable ? (
                  <>
                    <label className="sr-only" htmlFor={`role-${m.id}`}>
                      Role of {m.name}
                    </label>
                    <Select
                      compact
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
                    </Select>
                    {confirming === m.id ? (
                      <span className="flex gap-1.5">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void run(() => removeMember(m.id)).then(() => setConfirming(''))}
                          className="rounded-lg bg-red-700 px-2.5 py-1 text-xs font-medium text-white outline-none hover:bg-red-600 focus-visible:ring-2 focus-visible:ring-red-300 disabled:opacity-50"
                        >
                          Remove {m.name}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirming('')}
                          className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-teal-400"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirming(m.id)}
                        className="rounded-lg border border-slate-700 px-2.5 py-1 text-xs text-slate-300 outline-none hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-teal-400"
                      >
                        Remove
                      </button>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-slate-400">{label(m.role)}</span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
