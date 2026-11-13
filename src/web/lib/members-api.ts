/** The active church's people (admins and owners), through the typed API client. */
import type { Role } from '../../shared/permissions'
import { call, linksApi, membersApi } from './api'
export const listMembers = () => call(membersApi.$get())
export type MemberList = Awaited<ReturnType<typeof listMembers>>
export type MemberInfo = MemberList['members'][number]
export const addMember = (input: { email: string; name?: string; role: Role }) => call(membersApi.$post({ json: input }))
export const changeRole = (id: string, role: Role) => call(membersApi[':memberId'].$patch({ param: { memberId: id }, json: { role } }))
export const removeMember = (id: string) => call(membersApi[':memberId'].$delete({ param: { memberId: id } }))

/** Join links: made here, opened at /join/<token>. */
export const listLinks = () => call(linksApi.$get())
export type LinkList = Awaited<ReturnType<typeof listLinks>>
export type LinkInfo = LinkList['links'][number]
export const createLink = (input: { role: Role; singleUse: boolean }) => call(linksApi.$post({ json: input }))
export const revokeLink = (id: string) => call(linksApi[':linkId'].$delete({ param: { linkId: id } }))
