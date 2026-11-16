import { XIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
/**
 * A panel that rises from the bottom of the screen: the mobile layout's way to show a picker or a group of settings
 * (desktop uses popovers for the same contents). Glass, rounded at the top, at most 85% of the screen tall and scrolling
 * inside, with room for the home bar. Drag-free on purpose: closing is a big button, a tap outside, or the Esc key
 * (and the system Back button on Android, which Radix leaves to the page).
 */
export function MobileSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="max-h-[85dvh] gap-3 overflow-y-auto rounded-t-2xl border-x-0 border-b-0 border-white/10 bg-card/85 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] backdrop-blur-xl"
      >
        <div className="flex items-center justify-between gap-3">
          <SheetTitle className="text-base">{title}</SheetTitle>
          <SheetClose aria-label="Close" className="grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
            <XIcon aria-hidden="true" className="size-5" />
          </SheetClose>
        </div>
        <SheetDescription className="sr-only">{title}</SheetDescription>
        {children}
      </SheetContent>
    </Sheet>
  )
}
