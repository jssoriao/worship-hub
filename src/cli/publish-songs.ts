/**
 * Publishes the local song library of ONE church: to production (--target prod: the production
 * database and the real R2 bucket) or, by default, to development (the Neon dev branch and the LOCAL
 * R2 that `pnpm dev:api` serves, in <main checkout>/.wrangler/state, shared by every worktree).
 * Dev is how you try a song in the app on this machine; nothing in dev touches production.
 *
 *   pnpm songs:publish --church <church>                               to development (local R2)

 *   pnpm songs:publish --church <church> --target prod             all songs in ./songs (or SONGS_DIR)
 *   pnpm songs:publish "Song Folder" --church <church> --target prod   only that song (folder name = title)
 *
 * --church <slug> is required: songs belong to a church (never shared). The song is a row in the
 * database (found by its title, created when new); its id is what names everything in R2. The
 * database is the song list, so there is no index.json. A dev publish
 * creates the song in the dev database (its own id, never the production one); --dry-run creates nothing.
 *   pnpm songs:publish --dry-run          print what would be uploaded
 *   pnpm songs:publish --manifest-only    upload only the manifest (and index), no audio
 *   pnpm songs:publish --force            upload audio even if it looks unchanged
 *   pnpm songs:publish --tiers=standard   upload only some qualities (default: all three)
 *   pnpm songs:publish <song> --analysis  replace the analysis online (it is otherwise only uploaded once,
 *                                         because it is edited in the app afterwards)
 *
 * --tiers takes a comma list of standard (q4), saver (q6, data saver) and original, or "all".
 * The manifest in the bucket keeps the running record of which qualities are online, and the app
 * offers exactly those: publishing one quality never hides another that is already there. The app
 * shows a switcher for two or three, and none for one. Qualities are not removed by publishing.
 *
 * The folder name is the song's title and identifies it within the church. Renaming a folder makes a
 * new song; rename the title in the app instead.
 *
 * Layout in the bucket (the Worker maps /songs/<songId>/<path> to the key below, church from the session):
 *   churches/<churchId>/songs/<songId>/stems/manifest.json
 *   churches/<churchId>/songs/<songId>/stems/<file name>             "original": the files as they are
 *   churches/<churchId>/songs/<songId>/stems/standard/<file name>    re-encoded, VBR q4
 *   churches/<churchId>/songs/<songId>/stems/saver/<file name>       re-encoded, VBR q6 (data saver)
 *   churches/<churchId>/songs/<songId>/chart.pro, analysis.json
 * charts/ and lyrics/ can sit next to stems/ later. See TIERS in src/cli/lib/song-files.ts. Encoding
 * needs ffmpeg; the re-encoded files are cached in the temp folder.
 *
 * Audio is stored under its file name only. The folders (groups) and which file is a group's
 * combined stem live in the manifest, so you can reorganise the local folders and publish with
 * --manifest-only without uploading any audio again. Keep the file names unchanged for that.
 *
 * A file that is online already is skipped (and not re-encoded), so publishing again costs no data,
 * from any machine. For production the bucket itself says so: the song's files are listed first (one
 * request), an original counts as there when R2's etag is its MD5, and a re-encoded copy when the
 * manifest's `src` says it was made from the same source file. .publish-state.json (gitignored) is
 * this machine's record of its own uploads: it saves that check, and it is all the local R2 has.
 * --force uploads everything again.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ANALYSIS_FILE, currentAnalysis } from './lib/analysis.ts'
import { CHART_FILE, MIME, TIERS, cachedVariant, fileHash, fileMd5, isDir, listSongs, manifest, songMusic, stemFiles, tierPath, tierSizes, variantFile } from './lib/song-files.ts'
import { openDb } from '../db/client.ts'
import { loadTarget, splitTarget } from './lib/env.ts'
import { churchBySlug, ensureSong, songIdByTitle, userIdByEmail } from './lib/songs-db.ts'
import { WranglerStore } from './lib/r2.ts'
import { alreadyOnline, offeredTiers, parseTierList, pickVersion, sourcesFromManifest, tiersFromManifest, versionsFromManifest, type Listed, type TierStatus } from './tiers.ts'

const BUCKET = 'worship-hub'
// Every key is spelled out in full (churches/<churchId>/songs/<songId>/...), see rootOf below
const PREFIX = ''
// `wrangler r2 object put` refuses files larger than this
const MAX_BYTES = 300 * 1024 * 1024
const wrangler = path.resolve('node_modules/.bin/wrangler')

const { target, rest: argv } = splitTarget(process.argv.slice(2))
let churchSlug = ''
const args: string[] = []
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--church') churchSlug = argv[++i] ?? ''
  else if (argv[i].startsWith('--church=')) churchSlug = argv[i].slice('--church='.length)
  else args.push(argv[i])
}
const dryRun = args.includes('--dry-run')
const manifestOnly = args.includes('--manifest-only')
const force = args.includes('--force')
const only = args.filter((a) => !a.startsWith('--'))
if (!churchSlug) {
  console.error('Say which church: --church <slug> (pnpm churches list)')
  process.exit(1)
}
/**
 * Where the files go. Production: the real bucket. Dev (default): the local R2 that `pnpm dev:api` serves,
 * kept on this machine in one folder shared by all worktrees, with ids from the Neon dev branch.
 */
const remote = target === 'prod'
const R2_STATE = path.join(
  spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).stdout.trim() || path.resolve('.git'),
  '..',
  '.wrangler',
  'state',
)
/** The wrangler flags that choose the bucket: the real one, or the local one. */
const where = remote ? ['--remote'] : ['--local', '--persist-to', R2_STATE]
const databaseUrl = loadTarget(target)
const { db, close: closeDb } = openDb(databaseUrl)
const church = await churchBySlug(db, churchSlug)
if (!church) {
  console.error(`No church "${churchSlug}" in the ${target} database. pnpm churches list --target ${target}`)
  process.exit(1)
}
const operator = await userIdByEmail(db, process.env.WORSHIP_HUB_OPERATOR ?? spawnSync('git', ['config', 'user.email'], { encoding: 'utf8' }).stdout.trim())
/** The prefix of everything of one song in the bucket. */
const rootOf = (songId: string) => `churches/${church.id}/songs/${songId}`
const root = path.resolve(process.env.SONGS_DIR || 'songs')

// --tiers=standard,saver,original (default: all). Anything else on the line that starts with --
// is a mistake worth stopping for, since it would otherwise be taken for a song name or ignored.
let wantedTiers: string[]
try {
  const unknown = args.filter((a) => a.startsWith('--') && !/^--(dry-run|manifest-only|force|analysis|tiers=.*)$/.test(a))
  if (unknown.length) throw new Error(`Unknown option ${unknown.join(', ')}.${unknown.includes('--tiers') ? ' Write it as --tiers=standard,saver.' : ''}`)
  wantedTiers = parseTierList(args.find((a) => a.startsWith('--tiers='))?.slice('--tiers='.length))
} catch (e) {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
}

const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`

// ---------------------------------------------------------------- what is already uploaded

const STATE_FILE = path.resolve('.publish-state.json')
const state: Record<string, string> = (() => {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as Record<string, string>
  } catch {
    return {}
  }
})()
const saveState = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 1) + '\n')
// dev uploads are remembered apart from production ones, so one never makes the other skip files
const stateKey = (key: string) => `${remote ? '' : 'dev:'}${BUCKET}/${PREFIX}${key}`
/** Identifies an upload by its source file and quality, not by the (cached) encoded file. */
const stamp = (src: string, q: number | null) => {
  const st = fs.statSync(src)
  return `${st.size}:${Math.round(st.mtimeMs)}:${q ?? 'orig'}`
}
const recorded = (key: string, s: string) => state[stateKey(key)] === s

// ---------------------------------------------------------------- wrangler

function run(wranglerArgs: string[], capture = false) {
  return spawnSync(wrangler, wranglerArgs, { stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'], encoding: 'utf8' })
}

/** Uploads one object, and with a `stamp` records it (the audio; the caller has checked it is needed). */
function put(key: string, file: string, contentType: string, s?: string) {
  console.log(`  ${PREFIX}${key}`)
  if (dryRun) return
  const result = run(['r2', 'object', 'put', `${BUCKET}/${PREFIX}${key}`, '--file', file, '--content-type', contentType, ...where])
  if (result.status !== 0) throw new Error(`Upload failed: ${key}`)
  if (s) {
    state[stateKey(key)] = s
    // the fingerprint of the exact bytes that were uploaded, for the manifest (see pickVersion)
    state[`${stateKey(key)}#v`] = fileHash(file)
    saveState()
  }
}

/**
 * What the song's manifest in the bucket says now: the qualities it lists and the fingerprints of
 * its files ([] and {} for a new song or an older manifest).
 */
function remoteManifest(songRoot: string) {
  const result = run(['r2', 'object', 'get', `${BUCKET}/${PREFIX}${songRoot}/stems/manifest.json`, ...where, '--pipe'], true)
  return result.status === 0
    ? { tiers: tiersFromManifest(result.stdout), versions: versionsFromManifest(result.stdout), sources: sourcesFromManifest(result.stdout) }
    : { tiers: [], versions: {}, sources: {} }
}

/**
 * The song's audio in the bucket (key -> size and etag), so a file already there is not uploaded
 * again, whatever this machine's record says. Production only: the local R2 has no listing outside
 * `wrangler dev`, and it lives on this machine, so its record is complete. Undefined if listing fails.
 */
const store = remote ? new WranglerStore(BUCKET) : undefined
async function listedAudio(songRoot: string): Promise<Map<string, Listed> | undefined> {
  if (!store) return undefined
  try {
    return new Map((await store.list(`${PREFIX}${songRoot}/stems/`)).map((o) => [o.key.slice(PREFIX.length), { size: o.size, etag: o.etag }]))
  } catch (error) {
    console.log(`  (could not list the bucket: ${error instanceof Error ? error.message : error}; going by this machine's record only)`)
    return undefined
  }
}

// ---------------------------------------------------------------- songs

if (!isDir(root)) {
  console.error(`Songs folder not found: ${root}`)
  process.exit(1)
}

const local = listSongs(root)
// a song can be named by its folder or by its slug
const matches = (s: { id: string; dir: string }, name: string) => s.dir === name || s.id === name
const selected = only.length ? local.filter((s) => only.some((name) => matches(s, name))) : local
const missing = only.filter((name) => !local.some((s) => matches(s, name)))
if (missing.length) {
  console.error(`Not found in ${root}: ${missing.join(', ')}`)
  console.error(`Available: ${local.map((s) => s.dir).join(', ') || '(none)'}`)
  process.exit(1)
}
if (selected.length === 0) {
  console.error(`No songs with audio in ${root}`)
  process.exit(1)
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'worship-hub-publish-'))
try {
  for (const song of selected) {
    // the song's row (found by title in this church, created when new; a dry run creates nothing)
    let songId: string
    if (dryRun) {
      songId = (await songIdByTitle(db, church.id, song.title)) ?? '<new song id>'
    } else {
      const music = songMusic(path.join(root, song.dir))
      songId = (await ensureSong(db, church.id, song.title, { stems: true, key: music?.key ?? null, bpm: music?.bpm ?? null, meter: music?.meter ?? null }, operator)).id
    }
    const songRoot = rootOf(songId)
    console.log(`\n${song.title} -> ${remote ? '' : 'local R2: '}${songRoot}${dryRun ? ' (dry run)' : ''}`)
    const songDir = path.join(root, song.dir)
    const stems = stemFiles(songDir).map((stem) => ({ stem, src: path.join(songDir, ...stem.parts) }))
    // what is online already (the manifest and the files in the bucket), and sizes known without encoding
    const { tiers: online, versions: onlineVersions, sources: onlineSources } = remoteManifest(songRoot)
    const listed = await listedAudio(songRoot)
    const known = tierSizes(songDir)
    // per file name and quality: the source fingerprint for the new manifest (see manifest())
    const sources: Record<string, Record<string, string>> = {}
    const statuses: TierStatus[] = []
    // for the fingerprints: the file of each selected quality, and which were uploaded in this run
    const fileOf: Record<string, string[]> = {}
    const uploadedNow: Record<string, boolean[]> = {}

    for (const tier of TIERS) {
      const q = tier.q
      const label = `${tier.id} (${q === null ? 'files as they are' : `VBR q${q}`})`
      const items = stems.map(({ stem, src }) => {
        const key = `${songRoot}/stems/${tierPath(tier.id, stem.base)}`
        const s = stamp(src, q)
        return {
          stem,
          src,
          key,
          s,
          type: q === null ? (MIME[path.extname(src).slice(1).toLowerCase()] ?? 'application/octet-stream') : 'audio/mpeg',
          // online already? (this machine's record, else the bucket); see alreadyOnline in tiers.ts
          online: alreadyOnline({
            force,
            recorded: recorded(key, s),
            original: q === null,
            listed,
            key,
            sourceMd5: () => fileMd5(src),
            sourceHash: () => fileHash(src),
            onlineSource: onlineSources[stem.base]?.[tier.id],
            cachedMd5: () => {
              const cached = q === null ? undefined : cachedVariant(src, q)
              return cached ? fileMd5(cached) : undefined
            },
          }),
        }
      })
      const status: TierStatus = {
        id: tier.id,
        complete: items.every((it) => it.online !== null || (!force && recorded(it.key, it.s))),
        remote: online.find((t) => t.id === tier.id),
        known: known.find((t) => t.id === tier.id)?.bytes,
      }
      statuses.push(status)
      // a quality left as it is keeps the sources the manifest already had for it
      for (const it of items) {
        const kept = onlineSources[it.stem.base]?.[tier.id]
        if (kept) (sources[it.stem.base] ??= {})[tier.id] = kept
      }

      if (!wantedTiers.includes(tier.id)) {
        console.log(`  ${label}: not selected (--tiers)${status.complete || status.remote ? ', stays online' : ''}`)
        continue
      }
      if (q === null) for (const { src } of items) if (fs.statSync(src).size > MAX_BYTES) throw new Error(`Too large for wrangler upload (300 MiB): ${src}`)
      const todo = items.map((it) => it.online === null && !manifestOnly)
      // encode only what will be uploaded (cached in the temp folder); a dry run does not encode
      const files: (string | undefined)[] = await Promise.all(
        items.map((it, i) => (q === null ? it.src : todo[i] && !dryRun ? variantFile(it.src, q) : cachedVariant(it.src, q))),
      )
      // a file's size: the local copy when there is one, else what the bucket has
      const sizes = items.map((it, i) => (files[i] ? fs.statSync(files[i]!).size : listed?.get(it.key)?.size))
      const allSized = sizes.every((n) => typeof n === 'number')
      const todoBytes = sizes.reduce<number>((n, size, i) => n + (todo[i] ? (size ?? 0) : 0), 0)
      const fromRecord = items.filter((it) => it.online === 'record').length
      const fromBucket = items.filter((it) => it.online === 'r2').length
      console.log(
        `  ${label}: ${items.length} files` +
          (allSized ? `, ${mb(sizes.reduce<number>((a, b) => a + (b ?? 0), 0))}` : '') +
          (fromRecord + fromBucket ? `, online already: ${fromRecord + fromBucket}${fromBucket ? ` (${fromBucket} found in the bucket)` : ''}` : '') +
          (manifestOnly ? ' [audio skipped: --manifest-only]' : `, to upload: ${todo.filter(Boolean).length} files${allSized || !dryRun ? `, ${mb(todoBytes)}` : ''}`),
      )
      items.forEach((it, i) => {
        if (todo[i]) return put(it.key, files[i]!, it.type, it.s)
        // found in the bucket: remember it here too, so the next publish on this machine needs no check
        if (it.online === 'r2' && !dryRun) {
          state[stateKey(it.key)] = it.s
          const v = onlineVersions[it.stem.base]?.[tier.id] ?? (q === null ? fileHash(it.src) : files[i] ? fileHash(files[i]!) : undefined)
          if (v) state[`${stateKey(it.key)}#v`] = v
          saveState()
        }
      })
      if (allSized) status.bytes = sizes.reduce<number>((a, b) => a + (b ?? 0), 0)
      fileOf[tier.id] = files.map((f) => f ?? '')
      uploadedNow[tier.id] = todo.map((t) => t && !dryRun)
      // uploaded now, or online already; a dry run assumes the uploads work
      status.complete = items.every((it, i) => it.online !== null || (todo[i] && (dryRun || recorded(it.key, it.s))))
      if (!status.complete) console.log(`  ! ${tier.id} is not fully uploaded, so the manifest will not offer it`)
      // this quality's copies were made from (or are) the current source files
      if (status.complete) for (const it of items) (sources[it.stem.base] ??= {})[tier.id] = fileHash(it.src)
    }

    const tiers = offeredTiers(statuses)
    console.log(`  the app will offer: ${tiers.map((t) => t.id).join(', ') || '(nothing: older single-quality layout)'}${tiers.length < 2 ? ' (no switcher)' : ''}`)
    // Fingerprint of every file of every offered quality. It goes into the file's address (?v=), so a
    // saved copy can be reused for good: same address, same bytes.
    const versions: Record<string, Record<string, string>> = {}
    for (const t of tiers) {
      const q = TIERS.find((x) => x.id === t.id)?.q ?? null
      stems.forEach(({ stem, src }, i) => {
        const file = fileOf[t.id]?.[i] || undefined
        const cached = q === null ? src : cachedVariant(src, q)
        const hash = pickVersion({
          uploadedNow: uploadedNow[t.id]?.[i] ?? false,
          measured: file && (q === null || file !== src) ? fileHash(file) : undefined,
          online: onlineVersions[stem.base]?.[t.id],
          recorded: state[`${stateKey(`${songRoot}/stems/${tierPath(t.id, stem.base)}`)}#v`],
          local: cached ? fileHash(cached) : undefined,
        })
        if (hash) (versions[stem.base] ??= {})[t.id] = hash
      })
    }
    const manifestFile = path.join(tmp, 'manifest.json')
    // waveforms go in the manifest so the app can draw stems it has not downloaded (needs ffmpeg)
    fs.writeFileSync(manifestFile, JSON.stringify(manifest(songDir, song.title, true, tiers, versions, sources)))
    console.log('  manifest')
    put(`${songRoot}/stems/manifest.json`, manifestFile, 'application/json')
    // the analysis (chords, beats, sections, timed lyrics), when the song has been through songs:analyse.
    // Once online it is edited in the app, so it is only uploaded when R2 has none yet, or with --analysis.
    const analysis = currentAnalysis(songDir)
    const onlineAlready = analysis && !args.includes('--analysis') && run(['r2', 'object', 'get', `${BUCKET}/${PREFIX}${songRoot}/${ANALYSIS_FILE}`, ...where, '--pipe'], true).status === 0
    if (onlineAlready) console.log('  analysis: online already, kept (edited in the app); --analysis replaces it')
    if (analysis && !onlineAlready) {
      const analysisFile = path.join(tmp, ANALYSIS_FILE)
      fs.writeFileSync(analysisFile, JSON.stringify(analysis))
      console.log(`  analysis (${(fs.statSync(analysisFile).size / 1024).toFixed(1)} KB)`)
      put(`${songRoot}/${ANALYSIS_FILE}`, analysisFile, 'application/json')
    }
    // the chart is small text, so it is uploaded every time (also with --manifest-only)
    const chartFile = path.join(songDir, CHART_FILE)
    if (fs.existsSync(chartFile)) {
      console.log('  chart')
      put(`${songRoot}/${CHART_FILE}`, chartFile, 'text/plain; charset=utf-8')
    }
  }

  console.log(`\n${dryRun ? 'Would publish' : 'Published'} ${selected.length} song(s) to ${church.name}.`)
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
  await closeDb()
}
