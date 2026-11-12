/**
 * Packs one local song into a zip that "Open zip" understands completely, including combined
 * stems and their parts. The zip is a copy of the song's stems/ folder in R2: manifest.json plus
 * every audio file side by side.
 *
 *   pnpm songs:pack "Song Folder"        writes ./packs/<slug>.zip
 *
 * Folders in the song become groups, and a file named like its folder is that group's combined
 * stem. Zips made any other way still open; they just show folders as plain group labels.
 */
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'
import { isDir, listSongs, manifest, stemFiles } from './lib/song-files.ts'

const name = process.argv.slice(2).find((a) => !a.startsWith('--'))
const root = path.resolve(process.env.SONGS_DIR || 'songs')

if (!isDir(root)) {
  console.error(`Songs folder not found: ${root}`)
  process.exit(1)
}
const songs = listSongs(root)
const song = songs.find((s) => s.dir === name || s.id === name)
if (!song) {
  console.error(name ? `Not found in ${root}: ${name}` : 'Usage: pnpm songs:pack "Song Folder"')
  console.error(`Available: ${songs.map((s) => s.dir).join(', ') || '(none)'}`)
  process.exit(1)
}

const songDir = path.join(root, song.dir)
const zip = new JSZip()
zip.file('manifest.json', JSON.stringify(manifest(songDir, song.title, true)))
for (const stem of stemFiles(songDir)) zip.file(stem.base, fs.readFileSync(path.join(songDir, ...stem.parts)))

fs.mkdirSync('packs', { recursive: true })
const out = path.join('packs', `${song.id}.zip`)
// mp3 and friends are already compressed, so store them as they are
fs.writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }))
console.log(`Wrote ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(1)} MB)`)
