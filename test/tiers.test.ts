import { describe, expect, it } from 'vitest'
import { alreadyOnline, sourcesFromManifest, type Listed } from '../src/cli/tiers.ts'

const KEY = 'churches/org_x/songs/song_x/stems/standard/bass.mp3'
const ORIGINAL = 'churches/org_x/songs/song_x/stems/bass.mp3'
const listed = new Map<string, Listed>([
  [KEY, { size: 1000, etag: '"aaaa"' }],
  [ORIGINAL, { size: 5000, etag: 'bbbb' }],
])
// each check counts the files it would have to read, to show they are only read when needed
const ask = (o: Partial<Parameters<typeof alreadyOnline>[0]>) => {
  const reads: string[] = []
  const answer = alreadyOnline({
    force: false,
    recorded: false,
    original: false,
    listed,
    key: KEY,
    sourceMd5: () => (reads.push('md5'), 'bbbb'),
    sourceHash: () => (reads.push('hash'), 'src1'),
    ...o,
  })
  return { answer, reads }
}

describe('alreadyOnline (what a publish may skip)', () => {
  it("trusts this machine's record without reading anything", () => {
    expect(ask({ recorded: true })).toEqual({ answer: 'record', reads: [] })
  })
  it('uploads everything with --force', () => {
    expect(ask({ force: true, recorded: true }).answer).toBeNull()
  })
  it('finds an original in the bucket by its MD5 (the etag)', () => {
    expect(ask({ original: true, key: ORIGINAL }).answer).toBe('r2')
    expect(ask({ original: true, key: ORIGINAL, sourceMd5: () => 'changed' }).answer).toBeNull()
  })
  it('finds a re-encoded copy by the source the manifest names, without encoding', () => {
    expect(ask({ onlineSource: 'src1' })).toEqual({ answer: 'r2', reads: ['hash'] })
    expect(ask({ onlineSource: 'old-source' }).answer).toBeNull() // the stem changed since: upload the new one
  })
  it('falls back to a local encode with the same bytes', () => {
    expect(ask({ cachedMd5: () => 'aaaa' }).answer).toBe('r2')
    expect(ask({ cachedMd5: () => undefined }).answer).toBeNull()
  })
  it('uploads what the bucket does not have, or when the bucket could not be listed', () => {
    expect(ask({ key: 'churches/org_x/songs/song_x/stems/standard/new.mp3', onlineSource: 'src1' })).toEqual({ answer: null, reads: [] })
    expect(ask({ listed: undefined, onlineSource: 'src1' }).answer).toBeNull()
    expect(ask({ listed: new Map([[KEY, { size: 0, etag: 'aaaa' }]]), onlineSource: 'src1' }).answer).toBeNull()
  })
})

describe('sourcesFromManifest', () => {
  it('reads src per file and quality, decoding names and ignoring junk', () => {
    const text = JSON.stringify({
      stems: [
        { file: 'lead%20vocals.mp3', src: { standard: 'abcdef0123456789', saver: 'abcdef0123456789' } },
        { file: 'bass.mp3', src: { standard: 'not a hash!' } },
        { file: 'drums.mp3' },
      ],
    })
    expect(sourcesFromManifest(text)).toEqual({ 'lead vocals.mp3': { standard: 'abcdef0123456789', saver: 'abcdef0123456789' } })
    expect(sourcesFromManifest('not json')).toEqual({})
  })
})
