/** Pure helpers for the Services pages: dates, ordering and link text. */
/** Today as `YYYY-MM-DD` on this device (the same wall-clock form services are stored in). */
export function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
// a date is read as UTC and printed as UTC, so the device's time zone never shifts the day
const atUtc = (date: string, time = '00:00') => new Date(`${date}T${time}:00Z`)
/** "Sun, Mar 2, 2031" */
export const formatDate = (date: string) => new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(atUtc(date))
/** "9:30 AM" (or the device's own style) */
export const formatTime = (time: string) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(atUtc('2000-01-01', time))
/** Upcoming first-to-come ascending, then past newest first. Today counts as upcoming. Input is newest first. */
export function splitServices<T extends { date: string; time: string | null }>(list: T[], now: string): { upcoming: T[]; past: T[] } {
  const upcoming = list.filter((s) => s.date >= now).sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? '').localeCompare(b.time ?? ''))
  const past = list.filter((s) => s.date < now).sort((a, b) => b.date.localeCompare(a.date) || (b.time ?? '').localeCompare(a.time ?? ''))
  return { upcoming, past }
}
export const serviceName = (s: { title: string | null }) => s.title || 'Service'
/** A copy of `list` with the item at `from` moved by `by` places (clamped); same list when nothing moves. */
export function move<T>(list: T[], from: number, by: number): T[] {
  const to = Math.min(list.length - 1, Math.max(0, from + by))
  if (from < 0 || from >= list.length || to === from) return list
  const out = [...list]
  out.splice(to, 0, ...out.splice(from, 1))
  return out
}
/** What a link shows: its label, else the site's name ("youtube.com"). */
export function linkText(link: { url: string; label: string }): string {
  if (link.label) return link.label
  try {
    return new URL(link.url).hostname.replace(/^www\./, '')
  } catch {
    return link.url
  }
}
/** True for an address the Worker accepts as a link: https only. */
export function isHttps(value: string): boolean {
  try {
    return new URL(value.trim()).protocol === 'https:'
  } catch {
    return false
  }
}
