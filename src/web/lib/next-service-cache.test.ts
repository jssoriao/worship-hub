import { beforeEach, describe, expect, it } from 'vitest'
import { forgetNextServices, saveNextService, savedNextService } from './next-service-cache'
import type { ServiceFull } from './services-api'

const service = (date: string) => ({ id: 'svc_x', date, time: null, title: null, notes: null, items: [] }) as unknown as ServiceFull
const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  const local = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  }
  // Object.keys(localStorage) lists the saved keys, as in a browser
  globalThis.localStorage = new Proxy(local, { ownKeys: () => [...store.keys()], getOwnPropertyDescriptor: (_t, k) => ({ enumerable: true, configurable: true, value: store.get(String(k)) }) }) as unknown as Storage
})

describe('saved next service', () => {
  it('returns what was saved for that church, today included, and nothing once it has passed', () => {
    saveNextService('org_a', service('2031-03-02'))
    expect(savedNextService('org_a', '2031-03-02')?.date).toBe('2031-03-02')
    expect(savedNextService('org_a', '2031-03-03')).toBeUndefined()
    expect(savedNextService('org_b', '2031-03-01')).toBeUndefined()
  })
  it('remembers that a church has none, and ignores unreadable copies', () => {
    saveNextService('org_a', null)
    expect(savedNextService('org_a', '2031-03-02')).toBeNull()
    store.set('worship-hub:next-service:org_b', '{bad')
    expect(savedNextService('org_b', '2031-03-02')).toBeUndefined()
  })
  it('forgets every church on sign-out and leaves other keys alone', () => {
    saveNextService('org_a', service('2031-03-02'))
    saveNextService('org_b', null)
    store.set('worship-hub:layout', 'desktop')
    forgetNextServices()
    expect([...store.keys()]).toEqual(['worship-hub:layout'])
  })
})
