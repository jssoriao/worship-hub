import { ArrowRightIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { practicePath, serviceKeyShift } from '../../lib/address'
import { useChurch } from '../../lib/church-context'
import { formatDate, formatTime, serviceName, splitServices, today, whenLabel } from '../../lib/services'
import { getService, listServices, type ServiceFull } from '../../lib/services-api'

/**
 * The church's next service, for the top of Home: when it is, its setlist in order (each song one tap from
 * Practice, in the key the service asks for), and quick links to the service and to its songs. Today counts as
 * upcoming. Nothing is shown when there is no upcoming service (or it cannot be loaded): the page simply
 * has no card.
 */
export function UpcomingService() {
  const church = useChurch()
  // undefined while loading; null when there is none; tied to the church it was loaded for
  const [loaded, setLoaded] = useState<{ church: string; service: ServiceFull | null } | undefined>(undefined)
  useEffect(() => {
    let live = true
    const finish = (service: ServiceFull | null) => live && setLoaded({ church: church.id, service })
    listServices()
      .then(async ({ services }) => {
        const next = splitServices(services, today()).upcoming[0]
        if (!next) return finish(null)
        finish((await getService(next.id)).service)
      })
      .catch(() => finish(null))
    return () => {
      live = false
    }
  }, [church.id])
  if (!loaded || loaded.church !== church.id) return <Skeleton aria-hidden="true" className="h-40 rounded-2xl" />
  const service = loaded.service
  if (!service) return null
  const now = today()
  // songs and plain lines are numbered; headers and positions are not
  const counted = (kind: string) => kind !== 'header' && kind !== 'position'
  const numbers = service.items.map((item, i) => (counted(item.kind) ? service.items.slice(0, i + 1).filter((l) => counted(l.kind)).length : 0))
  return (
    <Card className="gap-4 border-highlight/30 p-5 sm:p-6">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium tracking-wide text-highlight uppercase mobile:text-sm">Next service · {whenLabel(service.date, now)}</p>
          <h2 className="mt-1 truncate text-xl font-semibold tracking-tight mobile:text-2xl">{serviceName(service)}</h2>
          <p className="text-sm text-muted-foreground mobile:text-base">
            {formatDate(service.date)}
            {service.time ? ` · ${formatTime(service.time)}` : ''}
          </p>
        </div>
        <div className="flex w-full gap-2 sm:w-auto">
          <Link to={`/services/${service.id}`} className={`${buttonVariants()} mobile:h-11 mobile:flex-1`}>
            Service
            <ArrowRightIcon aria-hidden="true" />
          </Link>
          <Link to={`/services/${service.id}?tab=songs`} className={`${buttonVariants({ variant: 'outline' })} mobile:h-11 mobile:flex-1`}>
            Setlist
          </Link>
        </div>
      </div>
      {service.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No setlist yet.</p>
      ) : (
        <ol className="divide-y divide-border/60 border-t border-border/60">
          {service.items.map((item, i) => {
            if (item.kind === 'header') {
              return (
                <li key={item.id} className="pt-3 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase mobile:text-sm">
                  {item.title}
                </li>
              )
            }
            if (item.kind === 'position') {
              return (
                <li key={item.id} className="flex min-h-9 items-baseline gap-3 py-1 text-sm mobile:text-base">
                  <span className="w-5 shrink-0" />
                  <span className="w-32 shrink-0 truncate text-muted-foreground">{item.title}</span>
                  <span className="min-w-0 flex-1">{item.people.length > 0 ? item.people.map((p) => p.name).join(', ') : <span className="text-muted-foreground">Nobody yet</span>}</span>
                </li>
              )
            }
            const key = item.key || item.songKey
            const row = (
              <>
                <span className="w-5 shrink-0 text-xs text-muted-foreground tabular-nums mobile:text-sm">{numbers[i]}</span>
                <span className="min-w-0 flex-1 truncate text-sm mobile:text-base">{item.title}</span>
                {key && <span className="shrink-0 rounded-full border border-input px-2 py-0.5 text-xs mobile:text-sm">{key}</span>}
              </>
            )
            const className = 'flex min-h-9 items-center gap-3 py-1 mobile:min-h-12'
            return (
              <li key={item.id}>
                {item.kind === 'song' && item.songId && !item.archived ? (
                  <Link to={practicePath(item.songId, serviceKeyShift(item.songKey, item.key))} className={`${className} rounded-md outline-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring`}>
                    {row}
                  </Link>
                ) : (
                  <div className={`${className} text-muted-foreground`}>{row}</div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </Card>
  )
}
