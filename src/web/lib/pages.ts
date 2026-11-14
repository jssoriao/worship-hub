import { AudioLinesIcon, FileMusicIcon, HouseIcon, LibraryIcon, ListMusicIcon, UsersIcon } from 'lucide-react'

/**
 * The pages, in sidebar order. `admin` pages show only to people who may manage members, and the
 * sidebar groups them under a separator below the other pages; `owner` pages (not ready for everyone
 * yet) only to the church's owners. Arrange is in the admin group for now, though owner only.
 */
export const PAGES = [
  { to: '/', label: 'Home', icon: HouseIcon, end: true, admin: false, owner: false },
  { to: '/practice', label: 'Practice', icon: AudioLinesIcon, end: false, admin: false, owner: false },
  { to: '/charts', label: 'Charts', icon: FileMusicIcon, end: false, admin: false, owner: false },
  { to: '/manage-songs', label: 'Songs', icon: LibraryIcon, end: false, admin: true, owner: false, group: 'admin' },
  { to: '/arrange', label: 'Arrange', icon: ListMusicIcon, end: false, admin: false, owner: true, group: 'admin' },
  { to: '/members', label: 'Members', icon: UsersIcon, end: false, admin: true, owner: false, group: 'admin' },
] as const

/** Whether a page sits in the sidebar's admin group (under the separator). */
export const inAdminGroup = (page: (typeof PAGES)[number]) => 'group' in page && page.group === 'admin'

/** Whether this person is shown the page in the sidebar and on Home (and may open it). */
export function pageShown(page: (typeof PAGES)[number], who: { mayManage: boolean; role: string | null }): boolean {
  return (!page.admin || who.mayManage) && (!page.owner || who.role === 'owner')
}
