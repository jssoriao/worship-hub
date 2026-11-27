import { EventEmitter } from 'node:events'
import type { Pool } from '@neondatabase/serverless'
import { describe, expect, it } from 'vitest'
import { serverTiming, startTiming, timePool } from '../src/api/timing.ts'

describe('Server-Timing', () => {
  it('reports total, database time and count, connection and colo', () => {
    const timing = { ...startTiming(100), queries: 3, dbMs: 640.4, connectMs: 410.6 }
    expect(serverTiming(timing, 'SJC', 912)).toBe('total;dur=812, db;dur=640;desc="3 queries", connect;dur=411, colo;desc="SJC"')
  })

  it('leaves out an unknown connection and anything that is not a colo code', () => {
    const timing = { ...startTiming(0), queries: 1, dbMs: 5 }
    expect(serverTiming(timing, 'x"; evil', 10)).toBe('total;dur=10, db;dur=5;desc="1 query"')
  })

  it('counts pool queries, failed ones too, and times the first connection', async () => {
    const pool = Object.assign(new EventEmitter(), {
      async query(text: string) {
        pool.emit('connect')
        if (text === 'bad') throw new Error('bad')
        return { rows: [] }
      },
    })
    const timing = startTiming()
    timePool(pool as unknown as Pool, timing)
    await pool.query('select 1')
    await expect(pool.query('bad')).rejects.toThrow('bad')
    expect(timing.queries).toBe(2)
    expect(timing.connectMs).toBeGreaterThanOrEqual(0)
    expect(timing.dbMs).toBeGreaterThanOrEqual(0)
  })
})
