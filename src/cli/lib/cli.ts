/** Small helpers shared by the CLI scripts. */
import { isRole, ROLE_NAMES, type Role } from '../../shared/permissions.ts'

export interface Parsed {
  positional: string[]
  /** `--name value` or `--name=value`; a bare `--name` is `true` */
  flags: Record<string, string | true>
}

/** `valueFlags` are the flags that take a value (`--church my-church`); every other `--x` is a switch. */
export function parseArgs(args: string[], valueFlags: string[] = []): Parsed {
  const positional: string[] = []
  const flags: Record<string, string | true> = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (!a.startsWith('--')) {
      positional.push(a)
      continue
    }
    const eq = a.indexOf('=')
    const name = eq < 0 ? a.slice(2) : a.slice(2, eq)
    if (eq >= 0) flags[name] = a.slice(eq + 1)
    else if (valueFlags.includes(name)) flags[name] = args[++i] ?? ''
    else flags[name] = true
  }
  return { positional, flags }
}

export function parseRole(value: string | true | undefined): Role {
  if (value === undefined) return 'member'
  if (typeof value === 'string' && isRole(value)) return value
  throw new Error(`Role must be one of: ${ROLE_NAMES.join(', ')}`)
}

export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function parseSlug(value: string | undefined): string {
  if (!value || !SLUG.test(value) || value.length > 40) throw new Error('A church slug is lowercase letters, digits and dashes (e.g. my-church).')
  return value
}

export function normalizeEmail(value: string | undefined): string {
  const email = value?.trim().toLowerCase() ?? ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`"${value ?? ''}" is not a valid email address.`)
  return email
}
