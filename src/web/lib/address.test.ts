import { describe, expect, it } from 'vitest'
import { practicePath, resolveSongParam, songForAddress, songFromAddress } from './address'
import { pickChurch } from './church-context'
import { practiceLink } from './now-playing-context'

const library = [{ id: 'song_aaaaaaaaaaaaaaaaaaaaaaaa' }, { id: 'song_bbbbbbbbbbbbbbbbbbbbbbbb' }]

describe('resolveSongParam (the address alone chooses the song)', () => {
  it('no ?song opens nothing, even when a library is there', () => {
    expect(resolveSongParam('', library)).toEqual({ kind: 'none' })
    expect(resolveSongParam('', null)).toEqual({ kind: 'none' })
  })
  it('waits for the church list before judging an id', () => {
    expect(resolveSongParam('song_aaaaaaaaaaaaaaaaaaaaaaaa', null)).toEqual({ kind: 'waiting' })
  })
  it('opens a song of this church', () => {
    expect(resolveSongParam('song_bbbbbbbbbbbbbbbbbbbbbbbb', library)).toEqual({ kind: 'open', id: 'song_bbbbbbbbbbbbbbbbbbbbbbbb' })
  })
  it("flags an id that is not in this church's list", () => {
    expect(resolveSongParam('song_cccccccccccccccccccccccc', library)).toEqual({ kind: 'unknown', id: 'song_cccccccccccccccccccccccc' })
    expect(resolveSongParam('song_cccccccccccccccccccccccc', [])).toEqual({ kind: 'unknown', id: 'song_cccccccccccccccccccccccc' })
  })
})

describe('practiceLink (nav link carries the open song)', () => {
  it('links the open song of the active church', () => {
    expect(practiceLink({ songId: 'song_aaaaaaaaaaaaaaaaaaaaaaaa', churchId: 'c1' }, 'c1')).toBe('/practice?song=aaaaaaaaaaaaaaaaaaaaaaaa')
  })
  it('does not carry a song of another church, or no song', () => {
    expect(practiceLink({ songId: 'song_aaaaaaaaaaaaaaaaaaaaaaaa', churchId: 'c1' }, 'c2')).toBe('/practice')
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

describe('song ids in the address (no prefix)', () => {
  it('writes the id without its prefix and reads it back', () => {
    expect(songForAddress('song_aaaaaaaaaaaaaaaaaaaaaaaa')).toBe('aaaaaaaaaaaaaaaaaaaaaaaa')
    expect(songFromAddress('aaaaaaaaaaaaaaaaaaaaaaaa')).toBe('song_aaaaaaaaaaaaaaaaaaaaaaaa')
    expect(practicePath('song_aaaaaaaaaaaaaaaaaaaaaaaa')).toBe('/practice?song=aaaaaaaaaaaaaaaaaaaaaaaa')
  })
  it('accepts the full id, and keeps anything else as is (it then shows as unknown)', () => {
    expect(songFromAddress('song_aaaaaaaaaaaaaaaaaaaaaaaa')).toBe('song_aaaaaaaaaaaaaaaaaaaaaaaa')
    expect(songFromAddress('old-slug')).toBe('old-slug')
    expect(songFromAddress(null)).toBe('')
  })
})
