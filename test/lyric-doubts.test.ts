import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { addDoubts, buildAnalysis, type Analysis } from '../src/cli/lib/analysis.ts'
import { DOUBT_BELOW, doubtOf } from '../src/shared/doubt.ts'

// made-up words and scores only
const raw = [
  {
    text: 'one two three',
    start: 1,
    end: 4,
    words: [
      { word: 'one', start: 1, end: 1.5, score: 0.9 },
      { word: 'twu', start: 2, end: 2.5, score: 0.26 },
      { word: 'three', start: 3, end: 3.5, score: 0.39 },
    ],
  },
  { text: 'four', start: 5, end: 6, words: [{ word: 'four', start: 5, end: 5.5, score: 0.4 }] },
]
const dirs: string[] = []
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })))

function songFolder(lyrics: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'doubts-'))
  dirs.push(dir)
  const rawDir = path.join(dir, 'analysis', 'raw')
  fs.mkdirSync(rawDir, { recursive: true })
  fs.writeFileSync(path.join(rawDir, 'chords.json'), '[]')
  fs.writeFileSync(path.join(rawDir, 'beats.json'), '[]')
  fs.writeFileSync(path.join(rawDir, 'lyrics.json'), JSON.stringify(lyrics))
  return dir
}

describe('doubtOf', () => {
  it('is a whole percent for a score under the limit, else null', () => {
    expect(DOUBT_BELOW).toBe(0.4)
    expect(doubtOf(0.26)).toBe(26)
    expect(doubtOf(0.399)).toBe(40)
    expect(doubtOf(0.4)).toBeNull()
    expect(doubtOf(0.9)).toBeNull()
    for (const bad of [undefined, null, 'x', NaN, -1]) expect(doubtOf(bad)).toBeNull()
  })
})

describe('buildAnalysis', () => {
  it('keeps the score of unsure words as a fourth number, and of no others', () => {
    const a = buildAnalysis(songFolder(raw))!
    expect(a.lines[0][2]).toEqual([
      ['one', 1000, 1500],
      ['twu', 2000, 2500, 26],
      ['three', 3000, 3500, 39],
    ])
    expect(a.lines[1][2]).toEqual([['four', 5000, 5500]])
  })
})

describe('addDoubts (for analyses made, or edited, before they were kept)', () => {
  const plain = (): Analysis => {
    const a = buildAnalysis(songFolder(raw.map((l) => ({ ...l, words: l.words.map(({ score: _score, ...w }) => w) }))))!
    return a
  }

  it('flags the words that are still what was heard', () => {
    const { analysis, flagged } = addDoubts(plain(), raw)
    expect(flagged).toBe(2)
    expect(analysis.lines[0][2].map((w) => w[3])).toEqual([undefined, 26, 39])
  })

  it('leaves a word someone retyped or moved alone', () => {
    const edited = plain()
    edited.lines[0][2][1] = ['two', 2000, 2500] // retyped
    edited.lines[0][2][2] = ['three', 3200, 3700] // moved by 200 ms
    const { analysis, flagged } = addDoubts(edited, raw)
    expect(flagged).toBe(0)
    expect(analysis.lines[0][2].every((w) => w.length === 3)).toBe(true)
  })

  it('keeps doubts a word already has, changes nothing in the input, and is a no-op the second time', () => {
    const base = plain()
    const before = JSON.stringify(base)
    const once = addDoubts(base, raw)
    expect(JSON.stringify(base)).toBe(before)
    const twice = addDoubts(once.analysis, raw)
    expect(twice.flagged).toBe(0)
    expect(twice.analysis).toEqual(once.analysis)
  })

  it('copes with lyrics that are not there', () => {
    expect(addDoubts(plain(), undefined).flagged).toBe(0)
    expect(addDoubts(plain(), [{}, { words: 'x' }]).flagged).toBe(0)
  })
})
