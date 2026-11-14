import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { useHeaderSlot } from '../lib/header-slot'

interface Props {
  title: string
  /** a line under the title */
  description?: ReactNode
  /** the page's own controls (song picker, buttons), on the right; they wrap under the title on phones */
  actions?: ReactNode
}

/**
 * The top of every page, in one row: the sidebar toggle, the page title and the page's controls.
 * It replaces a top bar, so the page keeps its height. The church is named once, in the sidebar.
 * It is drawn into the shell's header slot (header-slot.ts), full width, so the toggle and title never move
 * between pages and the controls sit at the right edge.
 */
export function PageHeader({ title, description, actions }: Props) {
  const { el, shown } = useHeaderSlot()
  if (!el || !shown) return null
  return createPortal(
    <header className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex min-w-0 items-center gap-2">
        <SidebarTrigger className="-ml-1 text-muted-foreground" />
        <Separator orientation="vertical" className="h-5" />
        <h1 className="truncate text-lg font-semibold tracking-tight">{title}</h1>
      </div>
      {actions && <div className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto">{actions}</div>}
      {description && <p className="w-full text-sm text-muted-foreground">{description}</p>}
    </header>,
    el,
  )
}
