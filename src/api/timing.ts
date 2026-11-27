/**
 * Server-Timing for the API: how long a request spent waiting for the database, and how much of that
 * was opening the connection. The browser shows it under Network > Timing, and `curl -i` prints it.
 * Only totals and counts; no query text or data.
 */
import type { Pool } from '@neondatabase/serverless'

export type Timing = {
  /** performance.now() when the request reached the Worker */
  start: number
  /** queries finished, and the time spent in them (connection included for the first) */
  queries: number
  dbMs: number
  /** time from the first query to its connection being ready; undefined until a connection opens */
  connectMs?: number
  firstQueryAt?: number
}

export function startTiming(now = performance.now()): Timing {
  return { start: now, queries: 0, dbMs: 0 }
}

/** Counts every `pool.query` (what Drizzle and Better Auth use) and times the first connection. */
export function timePool(pool: Pool, timing: Timing): void {
  const query = pool.query.bind(pool) as (...args: unknown[]) => Promise<unknown>
  ;(pool as unknown as { query: (...args: unknown[]) => Promise<unknown> }).query = async (...args: unknown[]) => {
    const began = performance.now()
    timing.firstQueryAt ??= began
    try {
      return await query(...args)
    } finally {
      timing.queries += 1
      timing.dbMs += performance.now() - began
    }
  }
  pool.on('connect', () => {
    if (timing.connectMs === undefined && timing.firstQueryAt !== undefined) timing.connectMs = performance.now() - timing.firstQueryAt
  })
}

const ms = (value: number) => Math.round(value)

/** The header value, e.g. `total;dur=812, db;dur=640;desc="3 queries", connect;dur=410, colo;desc="SJC"`. */
export function serverTiming(timing: Timing, colo?: string, now = performance.now()): string {
  const parts = [`total;dur=${ms(now - timing.start)}`, `db;dur=${ms(timing.dbMs)};desc="${timing.queries} ${timing.queries === 1 ? 'query' : 'queries'}"`]
  if (timing.connectMs !== undefined) parts.push(`connect;dur=${ms(timing.connectMs)}`)
  if (colo && /^[A-Z]{3}$/.test(colo)) parts.push(`colo;desc="${colo}"`)
  return parts.join(', ')
}
