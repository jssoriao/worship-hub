/**
 * Sends a song to Music.AI for chords, sections and timed lyrics, and keeps every result locally:
 *
 *   pnpm songs:analyse "Song Folder" --church <church> --target prod
 *                                                                   uses the workflow worship-hub-analysis
 *
 * Music.AI costs credits, so only the platform super admin (user.platformAdmin, set with
 * `pnpm members platform-admin <email>`) may run it: the person running the script (WORSHIP_HUB_OPERATOR,
 * else `git config user.email`) is checked in the database first. That check is a safety net; the real
 * control is who holds the Keychain key and the database URL.
 *   pnpm songs:analyse <song> --workflow=<slug>                     another workflow
 *   pnpm songs:analyse <song> --dry-run                             only says what it would send
 *   pnpm songs:analyse <song> --with-audio                          also download audio results (stems are big)
 *
 * The input is a mix of the song's main stems (made with ffmpeg), uploaded to Music.AI's temporary
 * storage (deleted by them within 48 h). Each result is downloaded to songs/<song>/analysis/raw/ and
 * the job is then deleted on their side, so the data lives with us (published to R2 later).
 *
 * The API key is read from the macOS Keychain item "musicai-worship-hub" (or MUSICAI_API_KEY) and
 * never printed. Talks to the REST API directly (https://music.ai/docs/api/reference/), no SDK.
 * Costs money per minute of audio: see https://music.ai/pricing/.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Pool, neonConfig } from '@neondatabase/serverless'
import { listSongs, stemFiles } from '../dev/songs-plugin.ts'
import { loadTarget, splitTarget } from './lib/env.ts'
import { churchBySlug } from './lib/songs-db.ts'

const API = 'https://api.music.ai/v1'
const { target, rest: argv } = splitTarget(process.argv.slice(2))
let churchSlug = ''
const args: string[] = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--church') churchSlug = argv[++i] ?? ''
  else if (argv[i].startsWith('--church=')) churchSlug = argv[i].slice('--church='.length)
  else args.push(argv[i])
}
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const dryRun = args.includes('--dry-run')
const withAudio = args.includes('--with-audio')
const AUDIO_EXT = /\.(wav|mp3|m4a|aac|flac|ogg|opus)$/i
const workflow = flag('workflow') ?? 'worship-hub-analysis'
const songName = args.find((a) => !a.startsWith('--'))
if (!songName) {
  console.error('Usage: pnpm songs:analyse <song folder or slug> --church <slug> [--target prod] [--workflow=<slug>] [--dry-run]')
  process.exit(1)
}
if (!churchSlug) {
  console.error('Say which church the song belongs to: --church <slug>')
  process.exit(1)
}

function apiKey(): string {
  if (process.env.MUSICAI_API_KEY) return process.env.MUSICAI_API_KEY
  try {
    return execFileSync('security', ['find-generic-password', '-s', 'musicai-worship-hub', '-w'], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    console.error('No Music.AI key: add it to the Keychain as "musicai-worship-hub" (or set MUSICAI_API_KEY).')
    process.exit(1)
  }
}

async function api<T>(method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${route}`, {
    method,
    headers: { Authorization: apiKey(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${route}: HTTP ${res.status} ${text.slice(0, 300)}`)
  return (text ? JSON.parse(text) : {}) as T
}

/** Only the platform super admin may spend Music.AI credits. */
async function requirePlatformAdmin() {
  neonConfig.webSocketConstructor = WebSocket
  const pool = new Pool({ connectionString: loadTarget(target) })
  try {
    if (!(await churchBySlug(pool, churchSlug))) throw new Error(`No church "${churchSlug}" in the ${target} database.`)
    const operator = (process.env.WORSHIP_HUB_OPERATOR ?? execFileSync('git', ['config', 'user.email']).toString()).trim().toLowerCase()
    const { rows } = await pool.query<{ platformAdmin: boolean }>('select "platformAdmin" from "user" where email = $1', [operator])
    if (!rows[0]?.platformAdmin) throw new Error(`${operator || '(no email)'} is not the platform admin, so AI runs are not allowed. (pnpm members platform-admin <email>)`)
  } finally {
    await pool.end()
  }
}
if (!dryRun) {
  try {
    await requirePlatformAdmin()
  } catch (e) {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  }
}

const root = path.resolve('songs')
const song = listSongs(root).find((s) => s.id === songName || s.dir === songName)
if (!song) {
  console.error(`No song "${songName}" in ./songs`)
  process.exit(1)
}
const songDir = path.join(root, song.dir)
const outDir = path.join(songDir, 'analysis', 'raw')

// the main stems: combined stems and stems on their own (parts are already in their combined stem)
const files = stemFiles(songDir)
const combined = new Set(files.filter((f) => f.mix).map((f) => f.group))
const mains = files.filter((f) => f.mix || !combined.has(f.group)).map((f) => path.join(songDir, ...f.parts))
const seconds = Number(
  execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mains[0]]).toString().trim(),
)
console.log(`${song.title}: ${mains.length} main stems, ${(seconds / 60).toFixed(2)} min, workflow ${workflow}`)
if (dryRun) process.exit(0)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'worship-hub-analyse-'))
try {
  // 1. a mix of the main stems, as the full song
  const mix = path.join(tmp, 'mix.mp3')
  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    ...mains.flatMap((m) => ['-i', m]),
    '-filter_complex', `amix=inputs=${mains.length}:normalize=0,alimiter=limit=0.95`,
    '-c:a', 'libmp3lame', '-b:a', '192k', mix,
  ])
  console.log(`  mix ${(fs.statSync(mix).size / 1048576).toFixed(1)} MB`)

  // 2. upload it to their temporary storage
  const up = await api<{ uploadUrl: string; downloadUrl: string }>('GET', '/upload')
  const put = await fetch(up.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'audio/mpeg' }, body: fs.readFileSync(mix) })
  if (!put.ok) throw new Error(`upload: HTTP ${put.status}`)
  console.log('  uploaded')

  // 3. the job
  const { id } = await api<{ id: string }>('POST', '/job', { name: `worship-hub ${song.id}`, workflow, params: { inputUrl: up.downloadUrl } })
  console.log(`  job ${id}`)
  type Job = { status: string; result: Record<string, unknown> | null; error: { title: string; message: string } | null }
  let job: Job
  const started = Date.now()
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000))
    job = await api<Job>('GET', `/job/${id}`)
    process.stdout.write(`\r  ${job.status} ${Math.round((Date.now() - started) / 1000)} s   `)
    if (job.status === 'SUCCEEDED' || job.status === 'FAILED') break
  }
  console.log()
  if (job.status === 'FAILED') throw new Error(`job failed: ${job.error?.title}: ${job.error?.message}`)

  // 4. keep everything: each result as it came, plus the job itself
  fs.mkdirSync(outDir, { recursive: true })
  for (const [name, value] of Object.entries(job.result ?? {})) {
    if (typeof value === 'string' && /^https?:\/\//.test(value)) {
      const res = await fetch(value)
      if (!res.ok) throw new Error(`download ${name}: HTTP ${res.status}`)
      const ext = path.extname(new URL(value).pathname) || '.bin'
      if (AUDIO_EXT.test(ext) && !withAudio) {
        console.log(`  ${name}${ext} skipped (audio; rerun with --with-audio to download)`)
        continue
      }
      const file = path.join(outDir, `${name}${ext}`)
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
      console.log(`  ${name}${ext} ${(fs.statSync(file).size / 1024).toFixed(1)} KB`)
    } else {
      fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(value, null, 2))
      console.log(`  ${name}.json (inline)`)
    }
  }
  // the job record, without the result links (they are signed and expire)
  const outputs = Object.fromEntries(Object.entries(job.result ?? {}).map(([k, v]) => [k, typeof v === 'string' && /^https?:/.test(v) ? path.extname(new URL(v).pathname) : typeof v]))
  fs.writeFileSync(path.join(outDir, 'job.json'), JSON.stringify({ id, workflow, status: job.status, outputs, analysedAt: new Date().toISOString() }, null, 2))

  // 5. delete it on their side
  await api('DELETE', `/job/${id}`)
  console.log(`  job deleted at Music.AI; results in ${path.relative(process.cwd(), outDir)}`)
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
