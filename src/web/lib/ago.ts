/** How long ago an ISO time was, in short words, for lists like Members. */
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * "just now", "12 min ago", "3 h ago", "yesterday", "4 days ago", then the date ("12 Nov", with the year when
 * it is not this year). `hourly` is for times kept to the hour: anything under an hour is "within the hour".
 */
export function ago(iso: string, now: Date = new Date(), { hourly = false } = {}): string {
  const then = new Date(iso)
  const ms = now.getTime() - then.getTime()
  if (Number.isNaN(ms)) return ''
  if (ms < HOUR) return hourly ? 'within the hour' : ms < MINUTE ? 'just now' : `${Math.floor(ms / MINUTE)} min ago`
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h ago`
  const days = Math.round((startOfDay(now) - startOfDay(then)) / DAY)
  if (days <= 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(then.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }) })
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

/** The Members page line: "Active 2 h ago · Signed in 3 days ago"; parts not known yet are left out. */
export function activityLine(m: { lastActive: string | null; lastSignIn: string | null }, now: Date = new Date()): string {
  const parts = []
  if (m.lastActive) parts.push(`Active ${ago(m.lastActive, now, { hourly: true })}`)
  if (m.lastSignIn) parts.push(`Signed in ${ago(m.lastSignIn, now)}`)
  return parts.length > 0 ? parts.join(' · ') : 'Not signed in yet'
}
