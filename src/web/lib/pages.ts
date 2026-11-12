import { AudioLinesIcon, FileMusicIcon, HouseIcon, ListMusicIcon, UsersIcon } from 'lucide-react'

/** The pages, in sidebar order. `admin` pages show only to people who may manage members. */
export const PAGES = [
  { to: '/', label: 'Home', icon: HouseIcon, end: true, admin: false },
  { to: '/practice', label: 'Practice', icon: AudioLinesIcon, end: false, admin: false },
  { to: '/charts', label: 'Charts', icon: FileMusicIcon, end: false, admin: false },
  { to: '/arrange', label: 'Arrange', icon: ListMusicIcon, end: false, admin: false },
  { to: '/members', label: 'Members', icon: UsersIcon, end: false, admin: true },
] as const
