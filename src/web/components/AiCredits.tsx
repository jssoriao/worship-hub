import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { dollars } from '../../shared/ai-pieces'
import { getCredits, type Credits } from '../lib/ai-api'

/** This month's Music.AI credits for the church: used of the limit, as a bar. For people who may run Music.AI. */
export function AiCredits({ churchId }: { churchId: string }) {
  const [credits, setCredits] = useState<Credits | null>(null)
  useEffect(() => {
    let live = true
    getCredits().then(
      (r) => live && setCredits(r.usage),
      () => live && setCredits(null),
    )
    return () => {
      live = false
    }
  }, [churchId])
  if (!credits) return null
  const none = credits.limitCents === 0
  const share = credits.limitCents > 0 ? Math.min(100, (credits.usedCents / credits.limitCents) * 100) : 100
  const out = credits.remainingCents === 0
  return (
    <Card className="mt-5 gap-2 p-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">
          AI credits <span className="font-normal text-muted-foreground">· {credits.plan.name} plan</span>
        </h2>
        <p className="text-sm tabular-nums">
          <span className={out ? 'text-red-300' : ''}>{dollars(credits.usedCents)}</span>
          <span className="text-muted-foreground"> of {dollars(credits.limitCents)}</span>
        </p>
      </div>
      <div role="progressbar" aria-label="AI credits used this month" aria-valuemin={0} aria-valuemax={credits.limitCents} aria-valuenow={credits.usedCents} className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full ${out ? 'bg-red-400' : 'bg-brand-gradient'}`} style={{ width: `${share}%` }} />
      </div>
      {none && <p className="text-xs text-muted-foreground">AI is not part of this plan.</p>}
      {credits.platform.paused && <p className="text-xs text-amber-200">Paused: the limit for all churches is reached. It resets next month.</p>}
    </Card>
  )
}
