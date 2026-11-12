/**
 * ONE-OFF (new ids, #21): moves R2 files to the keys of the new church and song ids.
 *
 *   pnpm r2:rekey [--target prod]                 copies every churches/<old>/songs/<old>/... object to its new key
 *   pnpm r2:rekey [--target prod] --delete-old    then deletes the old keys (only where the new copy exists)
 *
 * The old -> new ids come from .id-map.<target>.json, written by `pnpm db:move`. The copying runs in a
 * temporary Worker (src/cli/lib/rekey-worker.ts) inside Cloudflare, so no file goes through this
 * machine: for production it is deployed as `worship-hub-rekey` and deleted at the end; for dev it runs
 * under `wrangler dev` on the local bucket (stop `pnpm dev:api` first). Old keys stay until --delete-old,
 * so the previous Worker version keeps working until then. .publish-state.json follows the new keys.
 * Delete this file once production runs on the new ids.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { splitTarget } from './lib/env.ts'

const BUCKET = 'worship-hub'
const WORKER = 'worship-hub-rekey'
const BATCH = 25
const { target, rest } = splitTarget(process.argv.slice(2))
const removeOld = rest.includes('--delete-old')
const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}

const mapFile = `.id-map.${target}.json`
if (!fs.existsSync(mapFile)) fail(`No ${mapFile}: run pnpm db:move${target === 'prod' ? ' --target prod' : ''} first.`)
const map = JSON.parse(fs.readFileSync(mapFile, 'utf8')) as { organization: Record<string, string>; song: Record<string, string> }

/** The new key for an old one, or null when it does not change. */
function newKey(key: string): string | null {
  const m = /^churches\/([^/]+)\/(?:songs\/([^/]+)\/)?(.*)$/.exec(key)
  if (!m) return null
  const [, org, song, rest] = m
  const org2 = map.organization[org] ?? org
  const song2 = song ? (map.song[song] ?? song) : undefined
  if (org2 === org && song2 === song) return null
  return song2 ? `churches/${org2}/songs/${song2}/${rest}` : `churches/${org2}/${rest}`
}

const wrangler = path.resolve('node_modules/.bin/wrangler')
const secret = randomBytes(24).toString('base64url')
const dir = path.resolve('node_modules/.tmp/rekey')
fs.mkdirSync(dir, { recursive: true })
const config = path.join(dir, 'wrangler.json')
// the secret is a plain var of a Worker that lives for minutes; the config file is removed at the end
fs.writeFileSync(
  config,
  JSON.stringify({
    name: WORKER,
    main: path.resolve('src/cli/lib/rekey-worker.ts'),
    compatibility_date: '2026-11-10',
    workers_dev: true,
    r2_buckets: [{ binding: 'FILES', bucket_name: BUCKET }],
    vars: { REKEY_SECRET: secret },
  }),
)

let dev: ChildProcess | undefined
let base = ''
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function start() {
  if (target === 'prod') {
    const r = spawnSync(wrangler, ['deploy', '--config', config], { encoding: 'utf8' })
    base = /https:\/\/[^\s]+\.workers\.dev/.exec(`${r.stdout}${r.stderr}`)?.[0] ?? fail(`Could not deploy ${WORKER}:\n${r.stderr.slice(-800)}`)
  } else {
    const state = path.join(spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).stdout.trim(), '..', '.wrangler', 'state')
    dev = spawn(wrangler, ['dev', '--config', config, '--ip', '127.0.0.1', '--port', '8799', '--persist-to', state], { stdio: 'ignore' })
    base = 'http://127.0.0.1:8799'
  }
  // a fresh workers.dev name can take a few seconds to answer
  for (let i = 0; i < 60; i++) {
    const ok = await fetch(base, { headers: { 'x-rekey-secret': secret } }).then((r) => r.ok, () => false)
    if (ok) return
    await sleep(1000)
  }
  fail(`${WORKER} did not answer at ${base}`)
}
function stop() {
  dev?.kill()
  if (target === 'prod' && base) spawnSync(wrangler, ['delete', '--config', config, '--force'], { stdio: 'ignore' })
  fs.rmSync(dir, { recursive: true, force: true })
}

const call = async (init?: RequestInit, query = '') => {
  const res = await fetch(`${base}/${query}`, { ...init, headers: { 'x-rekey-secret': secret, 'Content-Type': 'application/json' } })
  if (!res.ok) throw new Error(`${WORKER} answered ${res.status}`)
  return res.json()
}

try {
  await start()
  const keys: string[] = []
  let cursor: string | null = ''
  do {
    const page = (await call(undefined, `?prefix=churches/${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)) as { keys: string[]; cursor: string | null }
    keys.push(...page.keys)
    cursor = page.cursor
  } while (cursor)
  const moves = keys.flatMap((k) => {
    const to = newKey(k)
    return to ? [[k, to] as [string, string]] : []
  })
  console.log(`${keys.length} objects under churches/, ${moves.length} with old ids (${target}).`)
  let done = 0
  const missing: string[] = []
  for (let i = 0; i < moves.length; i += BATCH) {
    const r = (await call({ method: 'POST', body: JSON.stringify({ moves: moves.slice(i, i + BATCH), remove: removeOld }) })) as { done: number; missing: string[] }
    done += r.done
    missing.push(...r.missing)
    process.stdout.write(`\r  ${removeOld ? 'deleted' : 'copied'} ${done}/${moves.length}`)
  }
  console.log('')
  if (missing.length) console.log(`  ${missing.length} skipped (${removeOld ? 'new copy missing' : 'gone'}): ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', ...' : ''}`)
  if (!removeOld) {
    // the upload record follows the new keys, so the next publish does not upload everything again
    const stateFile = '.publish-state.json'
    if (fs.existsSync(stateFile)) {
      const state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) as Record<string, string>
      const prefix = `${BUCKET}/`
      const next = Object.fromEntries(Object.entries(state).map(([k, v]) => [k.startsWith(prefix) ? prefix + (newKey(k.slice(prefix.length)) ?? k.slice(prefix.length)) : k, v]))
      fs.writeFileSync(stateFile, JSON.stringify(next, null, 1) + '\n')
    }
    console.log(`Copied. Old keys stay until: pnpm r2:rekey${target === 'prod' ? ' --target prod' : ''} --delete-old`)
  }
} finally {
  stop()
}
