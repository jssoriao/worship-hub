import { describe, expect, it } from 'vitest'
import { embedUrl, mediaOf, youtubeId } from './media'
const ID = 'dQw4w9WgXcQ'
describe('media', () => {
  it('finds the video id in YouTube addresses', () => {
    for (const url of [
      `https://www.youtube.com/watch?v=${ID}&t=30s`,
      `https://youtube.com/watch?feature=share&v=${ID}`,
      `https://m.youtube.com/watch?v=${ID}`,
      `https://music.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}?si=abc`,
      `https://www.youtube.com/embed/${ID}`,
      `https://www.youtube.com/shorts/${ID}`,
      `https://www.youtube.com/live/${ID}`,
    ]) {
      expect(youtubeId(url), url).toBe(ID)
    }
  })
  it('does not take other addresses for videos', () => {
    for (const url of ['https://example.com/watch?v=' + ID, `http://youtu.be/${ID}`, 'https://www.youtube.com/playlist?list=PL1', 'https://www.youtube.com/watch?v=short', 'https://youtube.com.evil.example/watch?v=' + ID, 'nonsense']) {
      expect(youtubeId(url), url).toBeNull()
    }
  })
  it('describes a link', () => {
    expect(mediaOf(`https://youtu.be/${ID}`)).toEqual({ kind: 'youtube', id: ID, thumbnail: `https://img.youtube.com/vi/${ID}/mqdefault.jpg` })
    expect(mediaOf('https://example.com/chart.pdf')).toEqual({ kind: 'link' })
    expect(embedUrl(ID)).toBe(`https://www.youtube-nocookie.com/embed/${ID}?autoplay=1&rel=0&playsinline=1`)
  })
})
