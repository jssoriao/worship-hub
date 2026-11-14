/** What a song's link points at: a YouTube video (shown with a thumbnail and the small player) or any other page. */
export type Media = { kind: 'youtube'; id: string; thumbnail: string } | { kind: 'link' }
const YOUTUBE_ID = /^[\w-]{11}$/
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com'])
/** The video id in a YouTube address (watch, youtu.be, embed, shorts, live), or null. */
export function youtubeId(address: string): string | null {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  let id: string | null = null
  if (url.hostname === 'youtu.be') id = url.pathname.split('/')[1] ?? null
  else if (YOUTUBE_HOSTS.has(url.hostname)) {
    const [, first, second] = url.pathname.split('/')
    id = first === 'watch' ? url.searchParams.get('v') : first === 'embed' || first === 'shorts' || first === 'live' ? (second ?? null) : null
  }
  return id && YOUTUBE_ID.test(id) ? id : null
}
export function mediaOf(address: string): Media {
  const id = youtubeId(address)
  return id ? { kind: 'youtube', id, thumbnail: `https://img.youtube.com/vi/${id}/mqdefault.jpg` } : { kind: 'link' }
}
/** The address the small player embeds (the privacy-friendly YouTube domain, starts playing). */
export const embedUrl = (id: string): string => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1`
