import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { currentAnalysis, splitterAnalysis } from '../src/cli/lib/analysis.ts'

// a made-up song folder with the stem splitter's files
let dir = ''
const song = (files: Record<string, unknown>) => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'splitter-'))
  for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), JSON.stringify(data))
  return dir
}
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))
const grid = (beats: [number, number, number][]) => ({ summary: { displayBpm: 120, meter: { numerator: 4 } }, beats })
const key = (name: string, pitchClass: number, mode = 'major') => ({ summary: { key: { name, pitchClass, mode } } })
const qualities = ['min', 'maj', 'dim', 'aug', 'min6', 'maj6', 'min7', 'minmaj7', 'maj7', '7', 'dim7', 'hdim7', 'sus2', 'sus4']

describe('a song from the stem splitter', () => {
  it('numbers the beats in the bar, counting a pickup as the last beats of a bar', () => {
    const a = splitterAnalysis(song({ 'beat_grid.json': grid([[0.5, 0, 1], [1, 0, 1], [1.5, 1, 1], [2, 0, 1], [2.5, 0, 1], [3, 0, 1], [3.5, 1, 1]]) }))!
    expect(a.beats).toEqual([[500, 3], [1000, 4], [1500, 1], [2000, 2], [2500, 3], [3000, 4], [3500, 1]])
    expect(a.bpm).toBe(120)
    expect(a.chords).toEqual([])
  })
  it('reads the chord file, spelled in the key: flats in Db, sharps in E', () => {
    const chords = { qualities, chords: [[0, 1, -1, -1, 0.8], [1, 2, 1, 1, 0.9], [2, 3, 10, 6, 0.7], [3, 4, 8, 13, 0.6], [4, 5, 6, 11, 0.5]] }
    const flat = splitterAnalysis(song({ 'beat_grid.json': grid([[0, 1, 1]]), 'key_analysis.json': key('Db major', 1), 'chords.json': chords }))!
    expect(flat.key).toBe('Db major')
    expect(flat.chords).toEqual([
      [0, 1000, 'N', 'N', 'N', ''],
      [1000, 2000, 'Db', 'Db', 'Db', ''],
      [2000, 3000, 'Bbm', 'Bbm7', 'Bbm7', ''],
      [3000, 4000, 'Absus4', 'Absus4', 'Absus4', ''],
      [4000, 5000, 'Gbdim', 'Gbm7b5', 'Gbm7b5', ''],
    ])
    fs.rmSync(dir, { recursive: true, force: true })
    const sharp = splitterAnalysis(song({ 'beat_grid.json': grid([[0, 1, 1]]), 'key_analysis.json': key('C# minor', 1, 'minor'), 'chords.json': chords }))!
    expect(sharp.chords[1][3]).toBe('C#')
    expect(sharp.chords[2][3]).toBe('A#m7')
  })
  it('is only used when there is no Music.AI analysis, and needs a beat grid', () => {
    expect(splitterAnalysis(song({ 'key_analysis.json': key('C major', 0) }))).toBeNull()
    fs.rmSync(dir, { recursive: true, force: true })
    expect(currentAnalysis(song({ 'beat_grid.json': grid([[0, 1, 1]]) }))?.beats).toEqual([[0, 1]])
  })
})
