/**
 * R2 access for scripts. Listing uses the Cloudflare REST API (wrangler has no `r2 object list`);
 * copying and deleting go through wrangler. The token is CLOUDFLARE_API_TOKEN, else the one wrangler
 * saved when you logged in (refreshed by running a wrangler command first). It is never printed.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface R2Entry {
  key: string
  size: number
  etag: string
  contentType?: string
  customMetadata?: Record<string, string>
}

/** The operations the migration needs, so tests can use an in-memory bucket. */
export interface ObjectStore {
  list(prefix: string): Promise<R2Entry[]>
  /** Reads a (small) object, or null when missing. */
  read(key: string): Promise<Uint8Array | null>
  /** Copies `from` to `to` inside the bucket, keeping content type. */
  copy(from: R2Entry, to: string): Promise<void>
  delete(key: string): Promise<void>
}

const wrangler = () => path.resolve('node_modules/.bin/wrangler')

function wranglerToken(): string {
  // any wrangler command refreshes an expired OAuth token
  spawnSync(wrangler(), ['whoami'], { stdio: 'ignore' })
  const candidates = [path.join(os.homedir(), 'Library/Preferences/.wrangler/config/default.toml'), path.join(os.homedir(), '.config/.wrangler/config/default.toml')]
  for (const file of candidates) {
    try {
      const m = /oauth_token\s*=\s*"([^"]+)"/.exec(fs.readFileSync(file, 'utf8'))
      if (m) return m[1]
    } catch {
      // try the next place
    }
  }
  throw new Error('No Cloudflare token. Run `pnpm exec wrangler login` or set CLOUDFLARE_API_TOKEN.')
}

export class WranglerStore implements ObjectStore {
  private token = process.env.CLOUDFLARE_API_TOKEN || wranglerToken()
  private account: string | undefined = process.env.CLOUDFLARE_ACCOUNT_ID
  private tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'worship-hub-r2-'))
  private n = 0
  readonly bucket: string

  constructor(bucket: string) {
    this.bucket = bucket
  }

  private async api(pathAndQuery: string): Promise<Response> {
    this.account ??= await this.findAccount()
    return fetch(`https://api.cloudflare.com/client/v4/accounts/${this.account}${pathAndQuery}`, { headers: { Authorization: `Bearer ${this.token}` } })
  }

  private async findAccount(): Promise<string> {
    const res = await fetch('https://api.cloudflare.com/client/v4/accounts', { headers: { Authorization: `Bearer ${this.token}` } })
    const body = (await res.json()) as { result?: { id: string }[] }
    if (!body.result?.[0]) throw new Error('Could not find the Cloudflare account. Set CLOUDFLARE_ACCOUNT_ID.')
    return body.result[0].id
  }

  async list(prefix: string): Promise<R2Entry[]> {
    const out: R2Entry[] = []
    let cursor = ''
    for (;;) {
      const res = await this.api(`/r2/buckets/${this.bucket}/objects?prefix=${encodeURIComponent(prefix)}&per_page=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)
      if (!res.ok) throw new Error(`R2 list failed (${res.status})`)
      const body = (await res.json()) as {
        result: { key: string; size: number; etag: string; http_metadata?: { contentType?: string }; custom_metadata?: Record<string, string> }[]
        result_info?: { cursor?: string; is_truncated?: boolean }
      }
      for (const o of body.result) {
        out.push({ key: o.key, size: o.size, etag: o.etag, contentType: o.http_metadata?.contentType, customMetadata: o.custom_metadata && Object.keys(o.custom_metadata).length ? o.custom_metadata : undefined })
      }
      if (!body.result_info?.is_truncated || !body.result_info.cursor) break
      cursor = body.result_info.cursor
    }
    return out
  }

  private run(args: string[]) {
    return spawnSync(wrangler(), ['r2', 'object', ...args, '--remote'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  }

  async read(key: string): Promise<Uint8Array | null> {
    const file = path.join(this.tmp, `r${this.n++}`)
    const r = this.run(['get', `${this.bucket}/${key}`, '--file', file])
    if (r.status !== 0) return null
    try {
      return new Uint8Array(fs.readFileSync(file))
    } finally {
      fs.rmSync(file, { force: true })
    }
  }

  /** Runs a wrangler command, trying up to 3 times: copying hundreds of files over the network sometimes fails once. */
  private runRetry(args: string[], what: string) {
    let last = ''
    for (let attempt = 1; attempt <= 3; attempt++) {
      const r = this.run(args)
      if (r.status === 0) return
      last = (r.stderr || r.stdout || '').split('\n').find((l) => /error|fail|timeout|ECONN|fetch/i.test(l))?.slice(0, 160) ?? `exit ${r.status}`
    }
    throw new Error(`${what} (${last})`)
  }
  async copy(from: R2Entry, to: string): Promise<void> {
    const file = path.join(this.tmp, `c${this.n++}`)
    try {
      this.runRetry(['get', `${this.bucket}/${from.key}`, '--file', file], `could not read ${from.key}`)
      const args = ['put', `${this.bucket}/${to}`, '--file', file]
      if (from.contentType) args.push('--content-type', from.contentType)
      this.runRetry(args, `could not write ${to}`)
    } finally {
      fs.rmSync(file, { force: true })
    }
  }
  async delete(key: string): Promise<void> {
    const r = this.run(['delete', `${this.bucket}/${key}`])
    if (r.status !== 0) throw new Error(`could not delete ${key}`)
  }

  close() {
    fs.rmSync(this.tmp, { recursive: true, force: true })
  }
}
