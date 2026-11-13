import { describe, expect, it } from 'vitest'
import { MAX_TEMPO, MIN_TEMPO } from './engine'
import { stepTempo } from './tempo'

describe('stepTempo', () => {
  it('moves a whole BPM at a time when the tempo is known', () => {
    const up = stepTempo(1, 130, 1)
    expect(Math.round(130 * up)).toBe(131)
    expect(Math.round(130 * stepTempo(up, 130, 1))).toBe(132)
    expect(Math.round(130 * stepTempo(1, 130, -1))).toBe(129)
  })

  it('lands exactly on the recording when it comes back to its BPM', () => {
    expect(stepTempo(stepTempo(1, 130, 1), 130, -1)).toBe(1)
    expect(stepTempo(stepTempo(1, 97.5, -1), 97.5, 1)).toBe(1)
  })

  it('steps 5 % without a BPM', () => {
    expect(stepTempo(1, undefined, 1)).toBeCloseTo(1.05)
    expect(stepTempo(1, 0, -1)).toBeCloseTo(0.95)
    expect(stepTempo(1.05, undefined, -1)).toBe(1)
  })

  it('stays within the range', () => {
    expect(stepTempo(MAX_TEMPO, 120, 1)).toBe(MAX_TEMPO)
    expect(stepTempo(MIN_TEMPO, 120, -1)).toBe(MIN_TEMPO)
    expect(stepTempo(MAX_TEMPO, undefined, 1)).toBe(MAX_TEMPO)
  })
})
