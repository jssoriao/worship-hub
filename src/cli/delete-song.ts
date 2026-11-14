/**
 * Really deletes a song: its files and its database row. The app only ARCHIVES songs (regenerating the
 * AI data costs credits), so this is the one way to get rid of one for good.
 *
 *   pnpm songs:delete "<title>" --church <slug> [--target prod]                       shows what would go (deletes nothing)
 *   pnpm songs:delete "<title>" --church <slug> --confirm "<title>" [--target prod]   deletes it
 *
 * The title must be typed exactly, twice (as the song and as --confirm). Only --target prod deletes files:
 * the development database is a copy of production with the same ids, so a dev delete must never touch
 * production's files. It deletes the row only.
 */
import { openDb } from '../db/client.ts'
import { loadTarget, splitTarget } from './lib/env.ts'
import { WranglerStore } from './lib/r2.ts'
import { deleteSong, describeSongDelete, findSong } from './lib/song-delete.ts'
import { churchBySlug } from './lib/songs-db.ts'

const BUCKET = 'worship-hub'
const { target, rest } = splitTarget(process.argv.slice(2))
let churchSlug = ''
let confirm: string | undefined
const args: string[] = []
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--church') churchSlug = rest[++i] ?? ''
  else if (rest[i] === '--confirm') confirm = rest[++i]
  else args.push(rest[i])
}
const title = args[0]
const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}
if (!title || !churchSlug) fail('Usage: pnpm songs:delete "<title>" --church <slug> [--confirm "<title>"] [--target prod]')
const { db, close } = openDb(loadTarget(target))
const store = target === 'prod' ? new WranglerStore(BUCKET) : null
try {
  const church = (await churchBySlug(db, churchSlug)) ?? fail(`No church "${churchSlug}" in the ${target} database.`)
  const song = (await findSong(db, church.id, title)) ?? fail(`"${title}" is not a song of ${church.name} in the ${target} database (the title must match exactly).`)
  for (const line of await describeSongDelete(db, store, church.id, song)) console.log(line)
  if (confirm !== song.title) {
    console.log(`\nNothing was deleted. To delete it for good from the ${target} database${store ? ' and R2' : ''}:`)
    console.log(`  pnpm songs:delete "${song.title}" --church ${churchSlug} --confirm "${song.title}"${target === 'prod' ? ' --target prod' : ''}`)
  } else {
    const files = await deleteSong(db, store, church.id, song, (line) => console.log(line))
    console.log(`Deleted "${song.title}": ${files} file(s) from R2${store ? '' : ' (not touched)'}, and its row from the ${target} database.`)
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
} finally {
  store?.close()
  await close()
}
