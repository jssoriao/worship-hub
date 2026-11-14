import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { PlusIcon } from 'lucide-react'
import { Alert } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageHeader } from '../components/PageHeader'
import { ServiceDialog } from '../components/services/ServiceDialog'
import { useChurch } from '../lib/church-context'
import { formatDate, formatTime, serviceName, splitServices, today } from '../lib/services'
import { createService, listServices, type ServiceList } from '../lib/services-api'
type Show = 'upcoming' | 'past'
/** Everyone: the church's services, soonest first. Editors, admins and owners add new ones. */
export default function ServicesPage() {
  const church = useChurch()
  const navigate = useNavigate()
  const canPlan = church.can({ service: ['plan'] })
  const [list, setList] = useState<ServiceList | null>(null)
  const [error, setError] = useState('')
  const [show, setShow] = useState<Show>('upcoming')
  const [adding, setAdding] = useState(false)
  const load = useCallback(
    () =>
      listServices().then(
        (l) => {
          setList(l)
          setError('')
        },
        (e: unknown) => setError(e instanceof Error ? e.message : 'Could not load services.'),
      ),
    [],
  )
  useEffect(() => {
    // a promise, so state is only set after the answer arrives
    void load()
  }, [load, church.id])
  const { upcoming, past } = splitServices(list?.services ?? [], today())
  const rows = show === 'upcoming' ? upcoming : past
  return (
    <div className="mx-auto max-w-4xl px-4 pt-3 pb-24 md:px-6">
      <PageHeader
        title="Services"
        actions={
          <>
            <div role="group" aria-label="Show" className="inline-flex rounded-full border border-input p-0.5 text-sm">
              {(['upcoming', 'past'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={show === value}
                  onClick={() => setShow(value)}
                  className={`rounded-full px-3 py-0.5 capitalize outline-none focus-visible:ring-2 focus-visible:ring-ring ${show === value ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  {value} <span className="text-xs opacity-70">{value === 'upcoming' ? upcoming.length : past.length}</span>
                </button>
              ))}
            </div>
            {canPlan && (
              <Button size="sm" className="sm:ml-auto" onClick={() => setAdding(true)}>
                <PlusIcon /> Add
              </Button>
            )}
          </>
        }
      />
      {error && (
        <Alert variant="destructive" className="mt-3">
          {error}
        </Alert>
      )}
      {!list && !error && (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          Loading…
        </p>
      )}
      {list && rows.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">{show === 'upcoming' ? (canPlan ? 'No upcoming services. Use Add to start one.' : 'No upcoming services.') : 'No past services.'}</p>
      )}
      {rows.length > 0 && (
        <Card className="mt-3 gap-0 overflow-hidden py-0">
          <ul className="divide-y divide-border">
            {rows.map((s) => (
              <li key={s.id}>
                <Link to={`/services/${s.id}`} className="grid grid-cols-[9.5rem_4.5rem_1fr_auto] items-baseline gap-3 px-3 py-2 text-sm outline-none hover:bg-accent/40 focus-visible:bg-accent/40">
                  <span className="font-medium">{formatDate(s.date)}</span>
                  <span className="text-muted-foreground">{s.time ? formatTime(s.time) : ''}</span>
                  <span className="min-w-0 truncate">{serviceName(s)}</span>
                  <span className="text-xs text-muted-foreground">
                    {s.songs} {s.songs === 1 ? 'song' : 'songs'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {adding && (
        <ServiceDialog
          open
          heading="New service"
          action="Create"
          initial={{ date: '', time: '', title: '', notes: '' }}
          onClose={() => setAdding(false)}
          onSubmit={async (f) => {
            const { service } = await createService({ date: f.date, time: f.time || null, title: f.title.trim() || null, notes: f.notes.trim() || null })
            navigate(`/services/${service.id}`)
          }}
        />
      )}
    </div>
  )
}
