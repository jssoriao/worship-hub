/**
 * Marks the lyric words Music.AI was unsure of in a song's analysis that is already online:
 *
 *   pnpm songs:doubts "Song Folder" --church <church> [--target prod] [--dry-run]
 *
 * Analyses made before the scores were kept (and edited in the app since) have no flags, so nothing
 * would show up to review. This reads the scores from the song's raw results (songs/<song>/analysis/raw/lyrics.json),
 * adds them to the analysis in the bucket, and keeps the old version in the song's history, so nothing
 * edited in the app is lost. A word is flagged only when it is still what Music.AI heard (same text, same
 * start): a word someone retyped or moved is left alone. Running it again changes nothing.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openDb } from '../db/client.ts'
import { addDoubts, ANALYSIS_FILE, type Analysis } from './lib/analysis.ts'
import { loadTarget, splitTarget } from './lib/env.ts'
import { churchBySlug, songIdByTitle } from './lib/songs-db.ts'

const BUCKET = 'worship-hub'
const { target, rest: argv } = splitTarget(process.argv.slice(2))
let churchSlug = ''
const args: string[] = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--church') churchSlug = argv[++i] ?? ''
  else if (argv[i].startsWith('--church=')) churchSlug = argv[i].slice('--church='.length)
  else args.push(argv[i])
}
const dryRun = args.includes('--dry-run')
const name = args.find((a) => !a.startsWith('--'))
if (!name || !churchSlug) {
  console.error('Usage: pnpm songs:doubts "<song folder>" --church <slug> [--target prod] [--dry-run]')
  process.exit(1)
}

const remote = target === 'prod'
// the local R2 that `pnpm dev:api` serves lives in the main checkout, shared by worktrees
const R2_STATE = path.join(
  spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).stdout.trim() || path.resolve('.git'),
  '..',
  '.wrangler',
  'state',
)
const where = remote ? ['--remote'] : ['--local', '--persist-to', R2_STATE]
const wrangler = path.resolve('node_modules/.bin/wrangler')
const wr = (a: string[]) => spawnSync(wrangler, ['r2', 'object', ...a, ...where], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })

const rawFile = path.join(path.resolve(process.env.SONGS_DIR || 'songs'), name, 'analysis', 'raw', 'lyrics.json')
if (!fs.existsSync(rawFile)) {
  console.error(`No raw lyrics for this song: ${rawFile}`)
  process.exit(1)
}
const { db, close } = openDb(loadTarget(target))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'worship-hub-doubts-'))
try {
  const church = await churchBySlug(db, churchSlug)
  if (!church) throw new Error(`No church "${churchSlug}" in the ${target} database.`)
  const songId = await songIdByTitle(db, church.id, name)
  if (!songId) throw new Error(`"${name}" is not a song of ${church.name} in the ${target} database.`)
  const key = `${BUCKET}/churches/${church.id}/songs/${songId}`
  const got = wr(['get', `${key}/${ANALYSIS_FILE}`, '--pipe'])
  if (got.status !== 0) throw new Error('This song has no analysis online yet.')
  const online = JSON.parse(got.stdout) as Analysis
  const { analysis, flagged } = addDoubts(online, JSON.parse(fs.readFileSync(rawFile, 'utf8')))
  console.log(`${name}: ${flagged} word(s) flagged${flagged === 0 ? ' (nothing to change)' : ''}.`)
  if (flagged === 0 || dryRun) {
    if (dryRun) console.log('Dry run: nothing written.')
  } else {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const save = (objectKey: string, text: string) => {
      const file = path.join(tmp, 'o.json')
      fs.writeFileSync(file, text)
      if (wr(['put', objectKey, '--file', file, '--content-type', 'application/json']).status !== 0) throw new Error(`Could not write ${objectKey}`)
    }
    save(`${key}/analysis/history/${stamp}.json`, got.stdout)
    save(`${key}/${ANALYSIS_FILE}`, JSON.stringify(analysis))
    console.log('Written. The version before is in the history (Versions, in the editor).')
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exitCode = 1
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
  await close()
}
