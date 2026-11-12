/** The active church's people (admins and owners), through the typed API client. */
import type { Role } from '../../shared/permissions'
import { call, membersApi } from './api'
export const listMembers = () => call(membersApi.$get())
export type MemberList = Awaited<ReturnType<typeof listMembers>>
export type MemberInfo = MemberList['members'][number]
export const addMember = (input: { email: string; name?: string; role: Role }) => call(membersApi.$post({ json: input }))
export const changeRole = (id: string, role: Role) => call(membersApi[':memberId'].$patch({ param: { memberId: id }, json: { role } }))
export const removeMember = (id: string) => call(membersApi[':memberId'].$delete({ param: { memberId: id } }))
