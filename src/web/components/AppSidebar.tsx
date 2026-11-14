import { AudioLinesIcon, ChevronsUpDownIcon, LogOutIcon, SearchIcon } from 'lucide-react'
import { Fragment, useState } from 'react'
import { NavLink, useLocation } from 'react-router'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from '@/components/ui/sidebar'
import { audioCache } from '../lib/audio-cache'
import { authClient } from '../lib/auth-client'
import { useChurch } from '../lib/church-context'
import { practiceLink, useNowPlaying } from '../lib/now-playing-context'
import { inAdminGroup, PAGES, pageShown } from '../lib/pages'
import { DEFAULT_THEME } from '../lib/theme'


const initialOf = (text: string) => (text.trim()[0] ?? '?').toUpperCase()

// songs saved on this device are for members: they go when the person signs out
const signOut = () => void Promise.allSettled([authClient.signOut(), audioCache.clearAll()]).finally(() => window.location.replace('/'))

/** A square with the church's logo, or its initial on the brand gradient. */
function Mark({ logo, name, className = 'size-8' }: { logo: string | null; name: string; className?: string }) {
  return logo ? (
    <img src={logo} alt="" className={`${className} shrink-0 rounded-lg object-cover`} />
  ) : (
    <span aria-hidden="true" className={`${className} bg-brand-gradient flex shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-primary-foreground`}>
      {initialOf(name)}
    </span>
  )
}

/** The church you are in; with several, a menu (with a search once the list is long) to switch. */
function ChurchSwitcher() {
  const church = useChurch()
  const [query, setQuery] = useState('')
  const several = church.churches.length > 1
  const face = (
    <>
      <Mark logo={church.logo} name={church.name || '?'} />
      <span className="grid min-w-0 flex-1 text-left leading-tight">
        <span className="truncate text-sm font-medium">{church.name || 'Church'}</span>
        {church.role && <span className="truncate text-xs capitalize text-muted-foreground">{church.role}</span>}
      </span>
    </>
  )
  if (!several) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" className="pointer-events-none" aria-label={`Church: ${church.name}`}>
            {face}
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    )
  }
  const shown = church.churches.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()))
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu onOpenChange={() => setQuery('')}>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" aria-label={`Church: ${church.name}. Switch church`} className="data-[state=open]:bg-sidebar-accent">
              {face}
              <ChevronsUpDownIcon aria-hidden="true" className="ml-auto text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-60">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Churches</DropdownMenuLabel>
            {church.churches.length > 6 && (
              <div className="relative px-1 pb-1">
                <SearchIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  // typing goes to the box, not to the menu's type-ahead
                  onKeyDown={(e) => e.stopPropagation()}
                  placeholder="Search churches"
                  aria-label="Search churches"
                  className="h-8 w-full rounded-md border border-input bg-transparent pr-2 pl-8 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            )}
            {shown.map((c) => (
              <DropdownMenuItem key={c.id} onSelect={() => void church.switchTo(c.id)} aria-current={c.id === church.id ? 'true' : undefined}>
                <Mark logo={c.logo} name={c.name} className="size-6" />
                <span className="truncate">{c.name}</span>
              </DropdownMenuItem>
            ))}
            {shown.length === 0 && <p className="px-2 py-1.5 text-sm text-muted-foreground">No church matches.</p>}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

/** The signed-in person at the bottom, with Sign out. */
function Account() {
  const { data: session } = authClient.useSession()
  const { isMobile } = useSidebar()
  const name = session?.user.name ?? ''
  const email = session?.user.email ?? ''
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" aria-label="Account" className="data-[state=open]:bg-sidebar-accent">
              <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-medium">
                {initialOf(name || email)}
              </span>
              <span className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium">{name || email}</span>
                {name && <span className="truncate text-xs text-muted-foreground">{email}</span>}
              </span>
              <ChevronsUpDownIcon aria-hidden="true" className="ml-auto text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side={isMobile ? 'top' : 'right'} align="end" className="min-w-56">
            <DropdownMenuLabel className="font-normal">
              <p className="truncate text-xs text-muted-foreground">Signed in as</p>
              <p className="truncate">{email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={signOut}>
              <LogOutIcon aria-hidden="true" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

/**
 * The app's navigation, as in most dashboards: the app and church at the top, the pages, and the
 * person at the bottom. On desktop it folds to icons; on phones it opens as a drawer.
 */
export function AppSidebar() {
  const church = useChurch()
  const now = useNowPlaying()
  const { pathname } = useLocation()
  const { isMobile, setOpenMobile } = useSidebar()
  const mayManage = church.can({ member: ['create'] })
  const appName = church.theme.appName ?? DEFAULT_THEME.appName
  const shown = PAGES.filter((p) => pageShown(p, { mayManage, role: church.role }))
  const main = shown.filter((p) => !inAdminGroup(p))
  const admin = shown.filter(inAdminGroup)
  return (
    <Sidebar collapsible="icon" variant="sidebar">
      <SidebarHeader>
        <div className="flex h-8 items-center gap-2 px-2 group-data-[collapsible=icon]:px-0">
          <AudioLinesIcon aria-hidden="true" className="size-5 shrink-0 text-highlight" />
          <span className="truncate text-sm font-semibold tracking-wide uppercase group-data-[collapsible=icon]:hidden">{appName}</span>
        </div>
        <ChurchSwitcher />
      </SidebarHeader>
      <SidebarContent>
        {[main, admin].map(
          (pages, group) =>
            pages.length > 0 && (
              <Fragment key={group}>
                {/* the admin pages sit under a separator, below the others */}
                {group === 1 && <SidebarSeparator className="mx-0" />}
                <SidebarGroup>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {pages.map((p) => {
                        const active = p.end ? pathname === p.to : pathname === p.to || pathname.startsWith(`${p.to}/`)
                        const playingHere = p.to === '/practice' && now.playing
                        return (
                          <SidebarMenuItem key={p.to}>
                            <SidebarMenuButton asChild isActive={active} tooltip={p.label}>
                              <NavLink to={p.to === '/practice' ? practiceLink(now, church.id) : p.to} end={p.end} onClick={() => isMobile && setOpenMobile(false)}>
                                <p.icon aria-hidden="true" />
                                <span>{p.label}</span>
                                {playingHere && <span className="sr-only">{now.title ? `, playing ${now.title}` : ', playing'}</span>}
                              </NavLink>
                            </SidebarMenuButton>
                            {playingHere && (
                              <SidebarMenuBadge aria-hidden="true">
                                <span className="size-2 animate-pulse rounded-full bg-highlight" />
                              </SidebarMenuBadge>
                            )}
                          </SidebarMenuItem>
                        )
                      })}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              </Fragment>
            ),
        )}
      </SidebarContent>
      <SidebarFooter>
        <Account />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
