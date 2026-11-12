import { describe, expect, it } from 'vitest'
import { bare, fromBare, ID_PREFIX, isId, newId, type IdKind } from '../src/shared/ids.ts'

describe('ids', () => {
  it('are <prefix>_<24 lowercase letters and digits>, per kind', () => {
    for (const kind of Object.keys(ID_PREFIX) as IdKind[]) {
      const id = newId(kind)
      expect(id).toMatch(new RegExp(`^${ID_PREFIX[kind]}_[0-9a-z]{24}$`))
      expect(isId(kind, id)).toBe(true)
    }
    expect(newId('song')).toMatch(/^song_/)
    expect(newId('organization')).toMatch(/^org_/)
  })
  it('do not repeat over 10k ids', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 10_000; i++) seen.add(newId('song'))
    expect(seen.size).toBe(10_000)
  })
  it('check the kind, length and characters', () => {
    const song = newId('song')
    expect(isId('arrangement', song)).toBe(false)
    expect(isId('song', song.toUpperCase())).toBe(false)
    expect(isId('song', `${song}x`)).toBe(false)
    expect(isId('song', 'song_../../x')).toBe(false)
    expect(isId('song', 42)).toBe(false)
  })
  it('go to and from the address bar without their prefix', () => {
    const song = newId('song')
    expect(bare(song)).toHaveLength(24)
    expect(fromBare('song', bare(song))).toBe(song)
    expect(fromBare('song', song)).toBe(song)
    expect(fromBare('song', 'not-an-id')).toBeNull()
    expect(fromBare('song', newId('arrangement'))).toBeNull()
    expect(fromBare('song', '')).toBeNull()
  })
})
