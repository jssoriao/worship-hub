/**
 * A file that arrives over time. The downloader appends to it, and anything that needs bytes
 * (the MP3 indexer, a decoder) waits for them instead of for the whole file. All bytes stay in
 * one buffer, so reading is a view, not a copy.
 */

export class HttpError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`HTTP ${status}`)
    this.status = status
  }
}

export class ByteStream {
  private buf: Uint8Array
  private len = 0
  private expected: number | null = null
  private finished = false
  private failure: Error | null = null
  private readonly waiting = new Set<() => void>()
  private readonly listeners = new Set<() => void>()

  constructor() {
    this.buf = new Uint8Array(0)
  }

  /** A stream that already has all its bytes (a zip entry, a cached file). */
  static fromBytes(bytes: Uint8Array): ByteStream {
    const s = new ByteStream()
    s.buf = bytes
    s.len = bytes.length
    s.expected = bytes.length
    s.finished = true
    return s
  }

  /** bytes received so far, contiguous from the start of the file */
  get length() {
    return this.len
  }
  /** size of the whole file when known */
  get total() {
    return this.expected
  }
  /** every byte has arrived */
  get done() {
    return this.finished
  }
  /** the download failed or was cancelled */
  get error() {
    return this.failure
  }
  /** the bytes so far. A view: it does not move, but more bytes may arrive after it was taken. */
  bytes(): Uint8Array {
    return this.buf.subarray(0, this.len)
  }

  // ---- producer side

  /** Announces the final size so the buffer is allocated once. */
  setTotal(total: number) {
    this.expected = total
    if (this.buf.length < total) {
      const bigger = new Uint8Array(total)
      bigger.set(this.buf.subarray(0, this.len))
      this.buf = bigger
    }
  }

  append(chunk: Uint8Array) {
    if (this.finished || this.failure) return
    if (this.len + chunk.length > this.buf.length) {
      const bigger = new Uint8Array(Math.max(this.len + chunk.length, this.buf.length * 2, 1 << 20))
      bigger.set(this.buf.subarray(0, this.len))
      this.buf = bigger
    }
    this.buf.set(chunk, this.len)
    this.len += chunk.length
    this.notify()
  }

  finish() {
    if (this.finished || this.failure) return
    this.finished = true
    this.expected = this.len
    this.notify()
  }

  fail(error: Error) {
    if (this.finished || this.failure) return
    this.failure = error
    this.notify()
  }

  // ---- consumer side

  /** Called after every append, finish or failure. Returns a function that stops listening. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Resolves on the next append, finish or failure. */
  changed(): Promise<void> {
    return new Promise((resolve) => this.waiting.add(resolve))
  }

  /** Resolves when `n` bytes are here, or the file ended sooner. Throws if the download failed. */
  async whenLength(n: number): Promise<void> {
    for (;;) {
      if (this.failure) throw this.failure
      if (this.len >= n || this.finished) return
      await this.changed()
    }
  }

  /** Resolves when the whole file is here. Throws if the download failed. */
  async complete(): Promise<void> {
    await this.whenLength(Infinity)
  }

  private notify() {
    for (const listener of [...this.listeners]) listener()
    const waiting = [...this.waiting]
    this.waiting.clear()
    for (const resolve of waiting) resolve()
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** One request for the rest of the file, appended to `stream`. */
async function pump(stream: ByteStream, url: string, signal: AbortSignal): Promise<void> {
  const resumeAt = stream.length
  const res = await fetch(url, { signal, credentials: 'same-origin', headers: resumeAt > 0 ? { Range: `bytes=${resumeAt}-` } : undefined })
  if (!res.ok) throw new HttpError(res.status)
  if (!res.body) throw new Error('This browser cannot stream downloads.')

  // When resuming, a server that ignores Range sends the whole file again: skip what we have.
  let skip = resumeAt > 0 && res.status !== 206 ? resumeAt : 0
  const size = Number(res.headers.get('Content-Length'))
  const encoded = res.headers.has('Content-Encoding') // then Content-Length is not the file size
  if (!encoded && Number.isFinite(size) && size > 0) {
    const range = /\/(\d+)$/.exec(res.headers.get('Content-Range') ?? '')
    const total = res.status === 206 ? (range ? Number(range[1]) : resumeAt + size) : size
    if (stream.total === null) stream.setTotal(total)
  }

  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return
    if (skip > 0) {
      if (value.length <= skip) {
        skip -= value.length
        continue
      }
      stream.append(value.subarray(skip))
      skip = 0
    } else {
      stream.append(value)
    }
  }
}

/**
 * Downloads `url` into `stream`. A dropped connection is resumed from where it stopped (up to 3
 * times); a refusal from the server (401, 404...) is not retried. Cancelling is not an error to
 * report, but the stream is marked failed so anything waiting on it stops.
 */
export async function download(stream: ByteStream, url: string, signal: AbortSignal): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await pump(stream, url, signal)
      if (stream.total !== null && stream.length < stream.total) throw new Error('The connection closed early.')
      stream.finish()
      return
    } catch (e) {
      const error = e instanceof Error ? e : new Error('Download failed.')
      const refused = error instanceof HttpError && error.status >= 400 && error.status < 500 && error.status !== 416
      if (signal.aborted || refused || attempt >= 3) {
        stream.fail(signal.aborted ? new DOMException('Cancelled', 'AbortError') : error)
        return
      }
      await sleep(400 * (attempt + 1))
    }
  }
}
