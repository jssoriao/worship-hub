import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { AnalysisVersion } from '../../lib/analysis-edit'

/**
 * The buttons of Practice's edit mode (Save and Discard both end it). They stick to the top of the window, so they are in reach
 * wherever the page is scrolled; the bar has no text of its own, only a failed save shows one.
 */
export function EditBar({ dirty, saving, error, onSave, onDiscard, onVersions }: {
  /** there are changes not saved yet */
  dirty: boolean
  saving: boolean
  error: string
  onSave: () => void
  onDiscard: () => void
  onVersions: () => void
}) {
  return (
    <div role="region" aria-label="Editing" className="surface-glass sticky top-2 z-30 mx-auto w-fit max-w-full rounded-2xl border p-2 text-sm shadow-xl shadow-black/50">
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button size="sm" disabled={!dirty || saving} onClick={onSave}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
        {/* with nothing changed this is how to leave edit mode */}
        <Button size="sm" variant="outline" disabled={saving} onClick={onDiscard}>
          {dirty ? 'Discard changes' : 'Close'}
        </Button>
        <Button size="sm" variant="outline" disabled={saving} onClick={onVersions}>
          Versions
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 max-w-prose px-1 text-xs text-red-300">
          {error}
        </p>
      )}
    </div>
  )
}

/** Earlier versions of the analysis (each save keeps the one it replaced); opening one puts it in the editor, still to be saved. */
export function VersionsDialog({ open, versions, error, onOpenVersion, onClose }: {
  open: boolean
  /** null while they load */
  versions: AnalysisVersion[] | null
  error: string
  onOpenVersion: (file: string) => void
  onClose: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Versions</DialogTitle>
          <DialogDescription>Each save keeps the version it replaced.</DialogDescription>
        </DialogHeader>
        {versions === null ? (
          <p role="status" className="text-sm text-muted-foreground">
            Loading…
          </p>
        ) : versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No earlier versions yet.</p>
        ) : (
          <ul className="max-h-[50dvh] divide-y divide-border overflow-y-auto rounded-xl border">
            {versions.map((v) => (
              <li key={v.file} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  {new Date(v.savedAt).toLocaleString()}
                  {v.savedBy && <span className="block truncate text-xs text-muted-foreground">{v.savedBy}</span>}
                </span>
                <Button size="sm" variant="outline" aria-label={`Open the version of ${new Date(v.savedAt).toLocaleString()}`} onClick={() => onOpenVersion(v.file)}>
                  Open
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="text-xs text-red-300">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** Asked when leaving edit mode (Esc, another page or song) with changes that are not saved. */
export function UnsavedDialog({ open, saving, error, onSave, onDiscard, onCancel }: {
  open: boolean
  saving: boolean
  error: string
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !saving && onCancel()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Save your changes?</DialogTitle>
          <DialogDescription>You have changes that are not saved yet.</DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-xs text-red-300">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="outline" disabled={saving} onClick={onDiscard}>
            Don't save
          </Button>
          <Button disabled={saving} onClick={onSave} autoFocus>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
