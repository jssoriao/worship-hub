/** "10", "10.5", "$7.25" -> whole cents. Anything else (negative, three decimals, words, huge) is an Error. */
export function parseDollars(text: string | undefined): number {
  const m = /^\$?(\d{1,6})(?:\.(\d{1,2}))?$/.exec((text ?? '').trim())
  if (!m) throw new Error(`"${text ?? ''}" is not an amount in dollars (like 10 or 7.25)`)
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0)
}
