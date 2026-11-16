import { PlusIcon, XIcon } from 'lucide-react'
import { PEOPLE_MAX } from '../../../shared/positions'
import type { ItemPerson } from '../../lib/services-api'
import { ChoicePicker } from '../ChoicePicker'

/**
 * Who serves in a position: their names as chips, and (for someone who plans the service) a picker to add a member
 * of the church or a name typed in, and a way to take each one off. Everyone else just reads the names.
 */
export function PositionPeople({
  title,
  people,
  members,
  editable,
  onChange,
}: {
  /** the position's name, for screen readers */
  title: string
  people: ItemPerson[]
  /** the church's people to pick from (null while loading) */
  members: { id: string; name: string }[] | null
  editable: boolean
  onChange: (people: ItemPerson[]) => void
}) {
  if (!editable) {
    return <span className="min-w-0 flex-1 text-sm mobile:text-base">{people.length > 0 ? people.map((p) => p.name).join(', ') : <span className="text-muted-foreground">Nobody yet</span>}</span>
  }
  const taken = new Set(people.flatMap((p) => (p.userId ? [p.userId] : [])))
  return (
    <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      {people.map((p, i) => (
        <span key={`${p.userId ?? 'name'}:${p.name}:${i}`} className="inline-flex items-center gap-0.5 rounded-full border border-input py-0.5 pr-0.5 pl-2.5 text-sm mobile:text-base">
          <span className="max-w-48 truncate">{p.name}</span>
          <button
            type="button"
            aria-label={`Take ${p.name} off ${title}`}
            onClick={() => onChange(people.filter((_, j) => j !== i))}
            className="grid size-6 place-items-center rounded-full text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring mobile:size-9"
          >
            <XIcon aria-hidden="true" className="size-3.5" />
          </button>
        </span>
      ))}
      {people.length < PEOPLE_MAX && (
        <ChoicePicker
          title={`Who serves: ${title}`}
          placeholder="Search, or type a name"
          choices={(members ?? []).filter((m) => !taken.has(m.id)).map((m) => ({ id: m.id, label: m.name }))}
          onChoose={(c) => onChange([...people, { userId: c.id, name: c.label }])}
          onFree={(name) => onChange([...people, { userId: null, name }])}
          triggerLabel={`Add someone to ${title}`}
          variant="ghost"
          size="icon-sm"
          className="size-7 rounded-full border border-dashed border-input mobile:size-11"
          trigger={<PlusIcon aria-hidden="true" />}
        />
      )}
    </span>
  )
}
