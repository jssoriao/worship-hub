/**
 * Songs kept on the device. A stem that has downloaded completely is saved in the browser's Cache
 * Storage under its versioned URL (the ?v= fingerprint), so it can never be stale, and the next
 * open reads it from disk with no network at all. That also makes songs playable offline.
 *
 * Songs are grouped ("<song>|<quality>"). The least recently used groups are deleted once the
 * automatic cache passes AUTO_LIMIT; a song the person chose to keep is "pinned" and never
 * deleted by this code. (The browser may still evict storage under pressure; pinning asks it not to.)
 */
import { ByteStream, download } from './bytestream.ts'

const AUDIO = 'worship-hub-audio-v2'
const META = 'worship-hub-meta-v2'
const REGISTRY = 'worship-hub:audio-registry-v2'
/** Unpinned songs beyond this many bytes are removed, least recently used first. */
export const AUTO_LIMIT = 300 * 1024 * 1024

interface Group {
  /** url -> size in bytes */
  urls: Record<string, number>
  last: number
  pinned: boolean
}
type Registry = Record<string, Group>

// Looked up when used, not when this file loads, so tests can provide their own.
const store = () => (typeof caches === 'undefined' ? undefined : caches)

function readRegistry(): Registry {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(REGISTRY) ?? '{}')
    return parsed && typeof parsed === 'object' ? (parsed as Registry) : {}
  } catch {
    return {}
  }
}
function writeRegistry(registry: Registry) {
  try {
    localStorage.setItem(REGISTRY, JSON.stringify(registry))
  } catch {
    // storage full or blocked: the files still work, they just cannot be tracked for cleanup
  }
}
const sum = (g: Group) => Object.values(g.urls).reduce((n, b) => n + b, 0)

export interface GroupStatus {
  /** how many of the asked-for files are saved */
  cached: number
  bytes: number
  pinned: boolean
}

export const audioCache = {
  /** A saved file, or undefined. */
  async get(url: string): Promise<ArrayBuffer | undefined> {
    const caches = store()
    if (!caches) return undefined
    const hit = await (await caches.open(AUDIO)).match(url)
    return hit ? hit.arrayBuffer() : undefined
  },

  /** Saves a complete file under `group`, then removes old unpinned songs if over the limit. */
  async put(url: string, bytes: Uint8Array, group: string): Promise<void> {
    const caches = store()
    if (!caches) return
    await (await caches.open(AUDIO)).put(url, new Response(bytes as Uint8Array<ArrayBuffer>, { headers: { 'Content-Type': 'audio/mpeg', 'Content-Length': String(bytes.length) } }))
    const registry = readRegistry()
    const g = (registry[group] ??= { urls: {}, last: 0, pinned: false })
    g.urls[url] = bytes.length
    g.last = Date.now()
    writeRegistry(registry)
    await this.trim(group)
  },

  /** Marks a song as just used, so it is the last to be removed. */
  touch(group: string) {
    const registry = readRegistry()
    if (!registry[group]) return
    registry[group].last = Date.now()
    writeRegistry(registry)
  },

  status(group: string, urls: string[]): GroupStatus {
    const g = readRegistry()[group]
    if (!g) return { cached: 0, bytes: 0, pinned: false }
    const have = urls.filter((u) => u in g.urls)
    return { cached: have.length, bytes: have.reduce((n, u) => n + g.urls[u], 0), pinned: g.pinned }
  },

  /** Keep this song: it is not removed by the automatic cleanup. */
  async pin(group: string): Promise<void> {
    const registry = readRegistry()
    const g = (registry[group] ??= { urls: {}, last: Date.now(), pinned: false })
    g.pinned = true
    writeRegistry(registry)
    // ask the browser not to clear this storage when space is short (it may say no)
    await navigator.storage?.persist?.().catch(() => false)
  },

  /** The song stays saved but may be removed by the automatic cleanup again. */
  unpin(group: string) {
    const registry = readRegistry()
    if (!registry[group]) return
    registry[group].pinned = false
    registry[group].last = Date.now()
    writeRegistry(registry)
  },

  /** Deletes a song's saved files. */
  async remove(group: string): Promise<void> {
    const registry = readRegistry()
    const g = registry[group]
    delete registry[group]
    writeRegistry(registry)
    const caches = store()
    if (!caches || !g) return
    const cache = await caches.open(AUDIO)
    await Promise.all(Object.keys(g.urls).map((u) => cache.delete(u)))
  },

  /** Removes unpinned songs, oldest first, until the automatic cache is under the limit. `keep` is never removed. */
  async trim(keep?: string, limit = AUTO_LIMIT): Promise<void> {
    const registry = readRegistry()
    const unpinned = Object.entries(registry).filter(([, g]) => !g.pinned)
    let total = unpinned.reduce((n, [, g]) => n + sum(g), 0)
    for (const [name, g] of unpinned.sort((a, b) => a[1].last - b[1].last)) {
      if (total <= limit) break
      if (name === keep) continue
      total -= sum(g)
      await this.remove(name)
    }
  },

  usage(): { bytes: number; pinnedBytes: number } {
    const groups = Object.values(readRegistry())
    return { bytes: groups.reduce((n, g) => n + sum(g), 0), pinnedBytes: groups.filter((g) => g.pinned).reduce((n, g) => n + sum(g), 0) }
  },

  /** Everything: the saved files, the saved library lists and the book-keeping. Used on sign-out. */
  async clearAll(): Promise<void> {
    try {
      localStorage.removeItem(REGISTRY)
    } catch {
      // nothing to remove
    }
    const caches = store()
    if (!caches) return
    await Promise.all([caches.delete(AUDIO), caches.delete(META)])
  },

  /** The song list and manifests are saved when they load, so they can be shown without a network. */
  async putJson(url: string, value: unknown): Promise<void> {
    const caches = store()
    if (!caches) return
    await (await caches.open(META)).put(url, new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } }))
  },

  async getJson<T>(url: string): Promise<T | undefined> {
    const caches = store()
    if (!caches) return undefined
    const hit = await (await caches.open(META)).match(url)
    return hit ? ((await hit.json()) as T) : undefined
  },
}

/**
 * Opens a stem for streaming. A saved copy is used when there is one; otherwise it downloads, and
 * when it has downloaded completely it is saved. Only files with a version are saved, since the
 * version in the URL is what makes a saved copy safe to reuse.
 */
export function openStem(o: { url: string; version?: string; group?: string; signal: AbortSignal }): ByteStream {
  const stream = new ByteStream()
  const group = o.version ? o.group : undefined
  void (async () => {
    if (group) {
      try {
        const hit = await audioCache.get(o.url)
        if (hit && !o.signal.aborted) {
          const bytes = new Uint8Array(hit)
          stream.setTotal(bytes.length)
          stream.append(bytes)
          stream.finish()
          audioCache.touch(group)
          return
        }
      } catch {
        // an unreadable saved copy: download it again
      }
    }
    await download(stream, o.url, o.signal)
    if (group && stream.done) audioCache.put(o.url, stream.bytes(), group).catch(() => {})
  })()
  return stream
}
