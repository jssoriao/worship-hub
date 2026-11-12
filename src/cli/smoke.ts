/**
 * pnpm smoke [url]   (default https://worshiphub.jssoriao.dev, or SMOKE_URL)
 * Checks that a deployed Worker answers, without signing in or touching data:
 *   /                  the PWA shell (static assets)
 *   /api/auth/ok       the Worker and Better Auth are up
 *   /songs/index.json  song routing answers 401 to a stranger
 * Retries for about a minute, since a new version takes a moment to reach every location.
 * Exit code 1 when a check still fails, so the deploy workflow can roll back.
 */
const base = (process.argv[2] ?? process.env.SMOKE_URL ?? 'https://worshiphub.jssoriao.dev').replace(/\/+$/, '')

const checks: { path: string; status: number; text?: string }[] = [
  { path: '/', status: 200, text: '<div id="root"' },
  { path: '/api/auth/ok', status: 200, text: '"ok":true' },
  { path: '/songs/index.json', status: 401 },
]

async function check(c: (typeof checks)[number]): Promise<string | null> {
  try {
    const res = await fetch(base + c.path, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers: { 'Cache-Control': 'no-cache' } })
    if (res.status !== c.status) return `${c.path}: expected ${c.status}, got ${res.status}`
    if (c.text && !(await res.text()).includes(c.text)) return `${c.path}: answer does not contain ${c.text}`
    return null
  } catch (e) {
    return `${c.path}: ${e instanceof Error ? e.message : String(e)}`
  }
}

let failures: string[] = []
for (let attempt = 1; attempt <= 6; attempt++) {
  failures = (await Promise.all(checks.map(check))).filter((f): f is string => f !== null)
  if (failures.length === 0) break
  console.log(`attempt ${attempt}/6 failed:\n  ${failures.join('\n  ')}`)
  if (attempt < 6) await new Promise((r) => setTimeout(r, 10_000))
}
if (failures.length > 0) {
  console.error(`smoke test failed for ${base}`)
  process.exit(1)
}
console.log(`smoke test passed for ${base}`)
