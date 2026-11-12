import { describe, expect, it } from 'vitest'
import { resolveSongParam } from './address'
import { pickChurch } from './church-context'
import { practiceLink } from './now-playing-context'

const library = [{ id: 'aaaaaaaaaaaa' }, { id: 'bbbbbbbbbbbb' }]

describe('resolveSongParam (the address alone chooses the song)', () => {
  it('no ?song opens nothing, even when a library is there', () => {
    expect(resolveSongParam('', library)).toEqual({ kind: 'none' })
    expect(resolveSongParam('', null)).toEqual({ kind: 'none' })
  })
  it('waits for the church list before judging an id', () => {
    expect(resolveSongParam('aaaaaaaaaaaa', null)).toEqual({ kind: 'waiting' })
  })
  it('opens a song of this church', () => {
    expect(resolveSongParam('bbbbbbbbbbbb', library)).toEqual({ kind: 'open', id: 'bbbbbbbbbbbb' })
  })
  it("flags an id that is not in this church's list", () => {
    expect(resolveSongParam('cccccccccccc', library)).toEqual({ kind: 'unknown', id: 'cccccccccccc' })
    expect(resolveSongParam('cccccccccccc', [])).toEqual({ kind: 'unknown', id: 'cccccccccccc' })
  })
})

describe('practiceLink (nav link carries the open song)', () => {
  it('links the open song of the active church', () => {
    expect(practiceLink({ songId: 'aaaaaaaaaaaa', churchId: 'c1' }, 'c1')).toBe('/practice?song=aaaaaaaaaaaa')
  })
  it('does not carry a song of another church, or no song', () => {
    expect(practiceLink({ songId: 'aaaaaaaaaaaa', churchId: 'c1' }, 'c2')).toBe('/practice')
    expect(practiceLink({ songId: '', churchId: 'c1' }, 'c1')).toBe('/practice')
  })
})

describe('pickChurch', () => {
  it('goes straight into the only church', () => {
    expect(pickChurch([{ id: 'a' }], '')).toBe('a')
  })
  it('uses the last church for several, else asks', () => {
    expect(pickChurch([{ id: 'a' }, { id: 'b' }], 'b')).toBe('b')
    expect(pickChurch([{ id: 'a' }, { id: 'b' }], 'gone')).toBeNull()
    expect(pickChurch([{ id: 'a' }, { id: 'b' }], '')).toBeNull()
  })
})
