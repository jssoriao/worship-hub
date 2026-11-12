/** A small in-memory stand-in for an R2 bucket (get with Range, head, put, list, delete). */
type Stored = { bytes: Uint8Array; contentType?: string; customMetadata?: Record<string, string>; uploaded: Date }

export class FakeR2 {
  objects = new Map<string, Stored>()

  put(key: string, value: string | Uint8Array, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }) {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
    this.objects.set(key, { bytes, contentType: options?.httpMetadata?.contentType, customMetadata: options?.customMetadata, uploaded: new Date() })
    return Promise.resolve()
  }

  private meta(key: string, o: Stored) {
    return {
      key,
      size: o.bytes.length,
      httpEtag: `"${key.length}-${o.bytes.length}"`,
      uploaded: o.uploaded,
      customMetadata: o.customMetadata,
      writeHttpMetadata: (h: Headers) => {
        if (o.contentType) h.set('Content-Type', o.contentType)
      },
    }
  }

  async head(key: string) {
    const o = this.objects.get(key)
    return o ? this.meta(key, o) : null
  }

  async get(key: string, options?: { range?: Headers }) {
    const o = this.objects.get(key)
    if (!o) return null
    let bytes = o.bytes
    let range: { offset: number; length: number } | undefined
    const header = options?.range?.get('Range')
    const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header) : null
    if (m && m[1] !== '') {
      const offset = Number(m[1])
      const end = m[2] === '' ? o.bytes.length - 1 : Math.min(Number(m[2]), o.bytes.length - 1)
      bytes = o.bytes.slice(offset, end + 1)
      range = { offset, length: bytes.length }
    }
    const copy = bytes.slice()
    return {
      ...this.meta(key, o),
      range,
      body: new ReadableStream({
        start(c) {
          c.enqueue(copy)
          c.close()
        },
      }),
      text: async () => new TextDecoder().decode(o.bytes),
      json: async () => JSON.parse(new TextDecoder().decode(o.bytes)),
    }
  }

  async list(options?: { prefix?: string; cursor?: string; limit?: number }) {
    const keys = [...this.objects.keys()].filter((k) => k.startsWith(options?.prefix ?? '')).sort()
    return { objects: keys.map((k) => this.meta(k, this.objects.get(k)!)), truncated: false as const, cursor: undefined }
  }

  async delete(keys: string | string[]) {
    for (const k of Array.isArray(keys) ? keys : [keys]) this.objects.delete(k)
  }
}
