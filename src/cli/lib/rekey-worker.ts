/**
 * A temporary Worker for `pnpm r2:rekey` (src/cli/r2-rekey.ts): copies R2 objects to new keys inside
 * Cloudflare, so nothing goes through the laptop running the script. It lives only while the script
 * runs (deployed under its own name for production, or `wrangler dev` for the local bucket).
 *
 * POST / with the header `x-rekey-secret` and `{ moves: [[from, to], ...], remove?: true }`:
 * copies each `from` to `to` (body, content type, custom metadata), or with `remove` deletes each
 * `from` after checking `to` exists. GET /?prefix=&cursor= lists keys. Answers counts only.
 */
interface Env {
  FILES: R2Bucket
  REKEY_SECRET: string
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!env.REKEY_SECRET || request.headers.get('x-rekey-secret') !== env.REKEY_SECRET) return json({ error: 'forbidden' }, 403)
    if (request.method === 'GET') {
      const url = new URL(request.url)
      const page = await env.FILES.list({ prefix: url.searchParams.get('prefix') ?? '', cursor: url.searchParams.get('cursor') || undefined, limit: 1000 })
      return json({ keys: page.objects.map((o) => o.key), cursor: page.truncated ? page.cursor : null })
    }
    const { moves, remove } = (await request.json()) as { moves: [string, string][]; remove?: boolean }
    let done = 0
    const missing: string[] = []
    for (const [from, to] of moves) {
      if (remove) {
        // only delete the old copy once the new one is there
        if (!(await env.FILES.head(to))) {
          missing.push(to)
          continue
        }
        await env.FILES.delete(from)
      } else {
        const object = await env.FILES.get(from)
        if (!object) {
          missing.push(from)
          continue
        }
        await env.FILES.put(to, object.body, { httpMetadata: object.httpMetadata, customMetadata: object.customMetadata })
      }
      done++
    }
    return json({ done, missing })
  },
} satisfies ExportedHandler<Env>
