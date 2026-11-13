import { AudioLinesIcon, FileMusicIcon, HouseIcon, ListMusicIcon, UsersIcon } from 'lucide-react'

/**
 * The pages, in sidebar order. `admin` pages show only to people who may manage members; `owner` pages
 * (not ready for everyone yet) only to the church's owners.
 */
export const PAGES = [
  { to: '/', label: 'Home', icon: HouseIcon, end: true, admin: false, owner: false },
  { to: '/practice', label: 'Practice', icon: AudioLinesIcon, end: false, admin: false, owner: false },
  { to: '/charts', label: 'Charts', icon: FileMusicIcon, end: false, admin: false, owner: false },
  { to: '/arrange', label: 'Arrange', icon: ListMusicIcon, end: false, admin: false, owner: true },
  { to: '/members', label: 'Members', icon: UsersIcon, end: false, admin: true, owner: false },
] as const

/** Whether this person is shown the page in the sidebar and on Home (and may open it). */
export function pageShown(page: (typeof PAGES)[number], who: { mayManage: boolean; role: string | null }): boolean {
  return (!page.admin || who.mayManage) && (!page.owner || who.role === 'owner')
}
