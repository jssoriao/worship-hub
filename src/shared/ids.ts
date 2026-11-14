/**
 * Ids for every row, Better Auth's tables included: `<prefix>_<24 chars of [0-9a-z]>`, for example
 * `song_mc3eqzamhnskc1dl99et2x8h`. The prefix says what the id is for; the 24 random characters
 * (nanoid, about 124 bits) make a repeat practically impossible. Lowercase and digits only, so they
 * are safe in URLs and R2 keys and case never matters.
 *
 * The browser's address bar shows ids without their prefix (`?song=mc3e...`); `bare` and `fromBare`
 * convert. Everything else (API, database, R2) uses the full id.
 */
import { customAlphabet } from 'nanoid'

export const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'
export const ID_LENGTH = 24

/** Prefixes by kind. The keys are Better Auth's model names, plus the app's own tables. */
export const ID_PREFIX = {
  user: 'user',
  session: 'sess',
  account: 'acct',
  verification: 'vrf',
  rateLimit: 'rl',
  organization: 'org',
  member: 'mem',
  invitation: 'inv',
  song: 'song',
  arrangement: 'arr',
  joinLink: 'link',
  joinRequest: 'jreq',
  service: 'svc',
  serviceItem: 'sit',
  aiJob: 'aij',
} as const
export type IdKind = keyof typeof ID_PREFIX

const random = customAlphabet(ID_ALPHABET, ID_LENGTH)

/** A new id of this kind. */
export const newId = (kind: IdKind): string => `${ID_PREFIX[kind]}_${random()}`

const BARE = new RegExp(`^[0-9a-z]{${ID_LENGTH}}$`)
const patterns = Object.fromEntries(Object.entries(ID_PREFIX).map(([kind, prefix]) => [kind, new RegExp(`^${prefix}_[0-9a-z]{${ID_LENGTH}}$`)])) as Record<IdKind, RegExp>

/** True for an id of this kind (right prefix, right length, right characters). */
export const isId = (kind: IdKind, value: unknown): value is string => typeof value === 'string' && patterns[kind].test(value)

/** The id without its prefix, for the address bar. */
export const bare = (id: string): string => id.slice(id.indexOf('_') + 1)

/** An id from the address bar: bare (`mc3e...`) or full (`song_mc3e...`); null if it is neither. */
export function fromBare(kind: IdKind, value: string | null | undefined): string | null {
  if (!value) return null
  if (isId(kind, value)) return value
  return BARE.test(value) ? `${ID_PREFIX[kind]}_${value}` : null
}
