import type { ReactNode } from 'react'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { useChurch } from '../lib/church-context'

interface Props {
  title: string
  /** a line under the title */
  description?: ReactNode
  /** the page's own controls (song picker, buttons), on the right; they wrap under the title on phones */
  actions?: ReactNode
}

/**
 * The top of every page, in one row: the sidebar toggle, a small "Church / Page" trail, the page
 * title and the page's controls. It replaces a top bar, so the page keeps its height.
 */
export function PageHeader({ title, description, actions }: Props) {
  const church = useChurch()
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger className="-ml-1 text-muted-foreground" />
        <Separator orientation="vertical" className="h-6" />
        <div className="min-w-0">
          {church.name && <p className="truncate text-xs text-muted-foreground">{church.name} / {title}</p>}
          <h1 className="truncate text-lg font-semibold leading-tight tracking-tight">{title}</h1>
        </div>
      </div>
      {actions && <div className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div>}
      {description && <p className="w-full text-sm text-muted-foreground">{description}</p>}
    </header>
  )
}
