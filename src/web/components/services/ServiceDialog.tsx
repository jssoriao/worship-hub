import { useState, type FormEvent } from 'react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
export interface ServiceFields {
  date: string
  time: string
  title: string
  notes: string
}
interface Props {
  open: boolean
  onClose: () => void
  heading: string
  /** the button's text */
  action: string
  initial: ServiceFields
  /** clone only asks for the date and time */
  datesOnly?: boolean
  /** throws with a message for people when it fails; the dialog stays open and shows it */
  onSubmit: (fields: ServiceFields) => Promise<void>
  /** shown at the left of the buttons (Delete) */
  extra?: React.ReactNode
}
/** Date, time (optional), title (optional) and notes of a service, for new, edit and clone. Mount it only while open (it keeps its own draft). */
export function ServiceDialog({ open, onClose, heading, action, initial, datesOnly = false, onSubmit, extra }: Props) {
  const [fields, setFields] = useState(initial)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<ServiceFields>) => setFields((f) => ({ ...f, ...patch }))
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await onSubmit(fields)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.')
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="gap-3 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3">
          {error && <Alert variant="destructive">{error}</Alert>}
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1">
              <Label htmlFor="sd-date" className="text-xs text-muted-foreground">
                Date
              </Label>
              <Input id="sd-date" type="date" required autoFocus className="h-8" value={fields.date} onChange={(e) => set({ date: e.target.value })} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="sd-time" className="text-xs text-muted-foreground">
                Time (optional)
              </Label>
              <Input id="sd-time" type="time" className="h-8" value={fields.time} onChange={(e) => set({ time: e.target.value })} />
            </div>
          </div>
          {!datesOnly && (
            <>
              <div className="grid gap-1">
                <Label htmlFor="sd-title" className="text-xs text-muted-foreground">
                  Title (optional)
                </Label>
                <Input id="sd-title" maxLength={120} placeholder="Service" className="h-8" value={fields.title} onChange={(e) => set({ title: e.target.value })} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="sd-notes" className="text-xs text-muted-foreground">
                  Notes (optional)
                </Label>
                <Textarea id="sd-notes" maxLength={1000} className="min-h-16" value={fields.notes} onChange={(e) => set({ notes: e.target.value })} />
              </div>
            </>
          )}
          <DialogFooter className="items-center sm:justify-between">
            <div>{extra}</div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy || !fields.date}>
                {action}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
