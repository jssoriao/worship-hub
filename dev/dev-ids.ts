/**
 * Song ids for the dev server. Songs are rows in the Neon dev database, so `?song=<id>` is the same
 * in dev and production; the dev server keeps serving the local ./songs folders and only asks the
 * database which id belongs to which folder (folder name = title, the rule `songs:publish` uses).
 * Missing rows are created. The answers are cached in .dev-song-ids.json so dev works offline.
 */
import fs from 'node:fs'
import { Pool, neonConfig } from '@neondatabase/serverless'
import { assertDevIsNotProd, parseVars } from '../scripts/lib/env.ts'
import { churchBySlug, ensureSong } from '../scripts/lib/songs-db.ts'

const CACHE = '.dev-song-ids.json'

export interface DevSong {
  title: string
  stems: boolean
}

/** The church dev works in: DEV_CHURCH from the environment or .dev.vars (a church slug in the dev database). */
function devChurch(): string {
  let fromFile = ''
  try {
    fromFile = parseVars(fs.readFileSync('.dev.vars', 'utf8')).DEV_CHURCH ?? ''
  } catch {
    // no .dev.vars: only the environment can say
  }
  const church = process.env.DEV_CHURCH || fromFile
  if (!church) throw new Error('Set DEV_CHURCH in .dev.vars to a church slug in the dev database (pnpm churches list).')
  return church
}

export function createDevIds(church = devChurch()) {
  const known = new Map<string, string>()
  let loadedCache = false

  const readCache = () => {
    try {
      const all = JSON.parse(fs.readFileSync(CACHE, 'utf8')) as Record<string, Record<string, string>>
      for (const [title, id] of Object.entries(all[church] ?? {})) known.set(title, id)
    } catch {
      // no cache yet
    }
    loadedCache = true
  }
  const writeCache = () => {
    let all: Record<string, Record<string, string>> = {}
    try {
      all = JSON.parse(fs.readFileSync(CACHE, 'utf8'))
    } catch {
      // fresh file
    }
    all[church] = Object.fromEntries(known)
    fs.writeFileSync(CACHE, JSON.stringify(all, null, 2))
  }

  return {
    /** title -> id for every song given; asks the database only for titles it doesn't know yet. */
    async resolve(songs: DevSong[]): Promise<Map<string, string>> {
      if (!loadedCache) readCache()
      const missing = songs.filter((s) => !known.has(s.title))
      if (missing.length > 0) {
        let vars: Record<string, string> = {}
        try {
          vars = parseVars(fs.readFileSync('.dev.vars', 'utf8'))
        } catch {
          throw new Error('.dev.vars not found: dev needs the Neon dev database (see .dev.vars.example)')
        }
        if (!vars.DATABASE_URL) throw new Error('DATABASE_URL missing in .dev.vars')
        assertDevIsNotProd(vars.DATABASE_URL)
        neonConfig.webSocketConstructor = WebSocket
        const pool = new Pool({ connectionString: vars.DATABASE_URL })
        try {
          const org = await churchBySlug(pool, church)
          if (!org) throw new Error(`Church "${church}" is not in the dev database. Run: pnpm churches add ${church} <name>`)
          for (const s of missing) known.set(s.title, (await ensureSong(pool, org.id, s.title, { stems: s.stems })).id)
          writeCache()
        } catch (error) {
          // offline or unreachable: titles seen before still work
          if (missing.some((s) => !known.has(s.title))) throw error
        } finally {
          await pool.end().catch(() => {})
        }
      }
      return known
    },
  }
}
