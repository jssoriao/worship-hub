import { beforeEach, describe, expect, it } from 'vitest'
import { forgetChurches, saveChurches, savedChurches, type SavedChurches } from './church-cache'

const store = new Map<string, string>()
beforeEach(() => {
  store.clear()
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  } as unknown as Storage
})
const church = (id: string) => ({ id, name: id, slug: id, theme: {}, logo: null })
const copy: SavedChurches = { userId: 'user_a', activeId: 'org_a', churches: [church('org_a'), church('org_b')], role: 'editor' }

describe('saved churches', () => {
  it('are used only for the same person and the same active church', () => {
    saveChurches(copy)
    expect(savedChurches('user_a', 'org_a')).toEqual(copy)
    expect(savedChurches('user_b', 'org_a')).toBeNull()
    expect(savedChurches('user_a', 'org_b')).toBeNull()
    expect(savedChurches('', '')).toBeNull()
  })
  it('ignore a copy without the active church, unreadable copies and unknown roles', () => {
    saveChurches({ ...copy, churches: [church('org_b')] })
    expect(savedChurches('user_a', 'org_a')).toBeNull()
    store.set('worship-hub:churches', '{bad')
    expect(savedChurches('user_a', 'org_a')).toBeNull()
    store.set('worship-hub:churches', JSON.stringify({ ...copy, role: 'boss' }))
    expect(savedChurches('user_a', 'org_a')?.role).toBeNull()
  })
  it('are forgotten on sign-out', () => {
    saveChurches(copy)
    forgetChurches()
    expect(savedChurches('user_a', 'org_a')).toBeNull()
  })
})
