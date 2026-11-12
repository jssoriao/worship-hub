/**
 * Short random ids for churches, songs and arrangements.
 * 12 chars of [a-z0-9] (36^12 is about 4.7e18): URL and R2-key safe, case never matters.
 */
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'
// largest multiple of 36 below 256, so every letter is equally likely (rejection sampling)
const LIMIT = 256 - (256 % ALPHABET.length)

export function newId(length = 12): string {
  let out = ''
  while (out.length < length) {
    const bytes = crypto.getRandomValues(new Uint8Array(length * 2))
    for (const b of bytes) {
      if (b < LIMIT && out.length < length) out += ALPHABET[b % ALPHABET.length]
    }
  }
  return out
}

/** Ids made by newId. */
export const ID_PATTERN = /^[a-z0-9]{12}$/
