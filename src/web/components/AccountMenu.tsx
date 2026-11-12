import { LogOutIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { audioCache } from '../lib/audio-cache'
import { authClient } from '../lib/auth-client'
import { useChurch } from '../lib/church-context'

const initialOf = (text: string) => (text.trim()[0] ?? '?').toUpperCase()

// songs saved on this device are for members: they go when the person signs out
const signOut = () => void Promise.allSettled([authClient.signOut(), audioCache.clearAll()]).finally(() => window.location.replace('/'))

/** The person's menu at the right end of the bar: who is signed in, their role here, and Sign out. */
export function AccountMenu() {
  const { data: session } = authClient.useSession()
  const church = useChurch()
  const name = session?.user.name ?? ''
  const email = session?.user.email ?? ''

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="icon-sm" aria-label="Account" title="Account" className="rounded-full">
          {initialOf(name || email)}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <p className="truncate font-medium">{name || email}</p>
          {name && <p className="truncate text-xs text-muted-foreground">{email}</p>}
          {church.role && <p className="mt-1 text-xs capitalize text-muted-foreground">{church.role}</p>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOutIcon aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
