import { describe, expect, it } from 'vitest'
import { normalizeEmail, parseArgs, parseRole, parseSlug } from '../scripts/lib/cli.ts'
import { dbIdentity, parseVars } from '../scripts/lib/env.ts'

describe('cli helpers', () => {
  it('parses flags with and without values', () => {
    const p = parseArgs(['add', 'a@b.co', 'Name', '--church', 'my-church', '--role=editor', '--revoke'], ['church', 'role'])
    expect(p.positional).toEqual(['add', 'a@b.co', 'Name'])
    expect(p.flags).toEqual({ church: 'my-church', role: 'editor', revoke: true })
  })
  it('accepts the four roles and rejects anything else', () => {
    for (const r of ['member', 'editor', 'admin', 'owner']) expect(parseRole(r)).toBe(r)
    expect(parseRole(undefined)).toBe('member')
    expect(() => parseRole('root')).toThrow()
    expect(() => parseRole(true)).toThrow()
  })
  it('validates slugs and emails', () => {
    expect(parseSlug('my-church')).toBe('my-church')
    expect(() => parseSlug('Bad Slug')).toThrow()
    expect(() => parseSlug(undefined)).toThrow()
    expect(normalizeEmail(' A@B.co ')).toBe('a@b.co')
    expect(() => normalizeEmail('nope')).toThrow()
  })
  it('reads KEY=value files', () => {
    expect(parseVars('# c\nA=1\nB="two words"\n\nC = x')).toEqual({ A: '1', B: 'two words', C: 'x' })
  })
  it('tells dev and prod databases apart by host and name, ignoring the pooler', () => {
    const prod = 'postgresql://u:p@ep-x-pooler.ap.aws.neon.tech/neondb?sslmode=require'
    expect(dbIdentity(prod)).toBe(dbIdentity('postgresql://u:p@ep-x.ap.aws.neon.tech/neondb'))
    expect(dbIdentity(prod)).not.toBe(dbIdentity('postgresql://u:p@ep-x-pooler.ap.aws.neon.tech/neondb_dev'))
  })
})
