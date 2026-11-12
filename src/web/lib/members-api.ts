import type { Role } from '../../shared/permissions'

export interface MemberInfo {
  id: string
  userId: string
  name: string
  email: string
  role: Role
  joined: string
}

export interface MemberList {
  members: MemberInfo[]
  /** roles the signed-in person may give, change or remove */
  manageable: Role[]
  me: string
}

async function send<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/church/members${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    credentials: 'same-origin',
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? 'Something went wrong. Try again.')
  }
  return (await res.json()) as T
}

export const listMembers = () => send<MemberList>('')
export const addMember = (input: { email: string; name?: string; role: Role }) =>
  send<MemberInfo>('', { method: 'POST', body: JSON.stringify(input) })
export const changeRole = (id: string, role: Role) => send<MemberInfo>(`/${id}`, { method: 'PATCH', body: JSON.stringify({ role }) })
export const removeMember = (id: string) => send<{ ok: true }>(`/${id}`, { method: 'DELETE' })
