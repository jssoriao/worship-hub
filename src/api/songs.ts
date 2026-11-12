/**
 * /songs/*: the signed-in member's active church. Song list and details come from the database;
 * files, charts and analyses from R2 (files.ts). The church always comes from the session, never
 * from the URL, and a song id is only honoured once the song is known to belong to it (songOwned).
 *
 *   GET    /songs/index.json                       the church's songs
 *   POST   /songs/new                {title}       add a song (no stems yet), so it can have a chart
 *   PATCH  /songs/<id>               {title?, artist?, key?, bpm?, meter?}
 *   DELETE /songs/<id>                             the row, its arrangements and every file
 *   GET    /songs/<id>/arrangements/               [{ id, name, owner, ownerName, updated }], newest first
 *   GET    /songs/<id>/arrangements/<aid>
 *   PUT    /songs/<id>/arrangements/<aid>          any member makes one; then only its owner or a manager
 *   DELETE /songs/<id>/arrangements/<aid>          (<aid>.json is accepted too)
 *   PUT    /songs/<id>/chart.pro                   text
 *   PUT    /songs/<id>/analysis.json               the replaced copy is kept under analysis/history/
 *   GET    /songs/<id>/analysis/history/           [{ file, savedAt, savedBy }], newest first
 *   GET    /songs/<id>/<rest>                      a file (stems/manifest.json, stems/<file>, chart.pro, ...)
 */
import { Hono, type Context } from 'hono'
import { createMiddleware } from 'hono/factory'
import * as z from 'zod'
import { isId } from '../shared/ids.ts'
import * as data from './data.ts'
import { serveFile } from './files.ts'
import { parseSongPath, songKey, songPrefix } from './keys.ts'
import { allowed, church, fail, need, sameOrigin, songOwned, type AppEnv } from './tenant.ts'
import { body, maxBody, only } from './validate.ts'
// plain parameters (a regex would show up in the typed client's paths); songOwned and arrangementId check them
const SONG = '/:songId'
const ARRANGEMENT = `${SONG}/arrangements/:arrangementId`
/** An arrangement id; `.json` on the end is accepted too (earlier versions of the app asked with it). */
const arrangementIdOf = (param: string | undefined) => {
  const id = param?.replace(/\.json$/, '')
  return isId('arrangement', id) ? id : undefined
}
const TITLE_MAX = 120
const CHART_MAX_BYTES = 200 * 1024
const ARRANGEMENT_MAX_BYTES = 100 * 1024
const ANALYSIS_MAX_BYTES = 1024 * 1024
/** Trimmed and cut to `max`; empty is not allowed. */
const requiredText = (max: number, message: string) =>
  z
    .string({ error: message })
    .transform((v) => v.trim().slice(0, max))
    .pipe(z.string().min(1, message))
/** Trimmed and cut to `max`; empty or null clears it. */
const optionalText = (max: number) =>
  z
    .string()
    .nullable()
    .transform((v) => (v === null ? null : v.trim().slice(0, max) || null))
const newSong = z.object({ title: requiredText(TITLE_MAX, 'Give the song a title') })
const songPatch = z.object({
  title: requiredText(TITLE_MAX, 'A song needs a title').optional(),
  artist: optionalText(TITLE_MAX).optional(),
  key: optionalText(12).optional(),
  bpm: z.number().gt(0).lt(1000).nullable().optional(),
  meter: z.int().gt(0).lt(33).nullable().optional(),
})
/** The document is free-form apart from these; what lives in its own column is not repeated in it. */
const arrangementBody = z.looseObject({ name: z.string().optional(), sections: z.array(z.unknown()), blocks: z.array(z.unknown()) })
const analysisBody = z.looseObject({
  v: z.literal(1),
  beats: z.array(z.unknown()),
  chords: z.array(z.unknown()),
  sections: z.array(z.unknown()),
  lines: z.array(z.unknown()),
})
/** waitUntil, when the runtime has one (tests may not pass an execution context). */
const executionCtx = (c: Context) => {
  try {
    return c.executionCtx
  } catch {
    return undefined
  }
}
const methodNotAllowed = (c: Context) => c.json({ error: 'method not allowed' }, 405)
const stored = (row: data.ArrangementRow, songId: string) => ({ ...row.data, id: row.id, song: songId, name: row.name, owner: row.owner ?? '', updated: row.updated })
const arrangementId = (c: Context) => arrangementIdOf(c.req.param('arrangementId'))
type ArrangementEnv = AppEnv & { Variables: { arrangement: data.ArrangementRow | null } }
/** Loads the arrangement; once made, only its owner or someone who may manage arrangements changes it. */
const arrangementWrite = createMiddleware<ArrangementEnv>(async (c, next) => {
  const { db } = c.get('deps')
  const tenant = c.get('tenant')
  const id = arrangementId(c)
  if (!id) return fail(c, 404, 'not found')
  const existing = await data.getArrangement(db, tenant.orgId, c.req.param('songId')!, id)
  if (existing && existing.owner !== tenant.user.id && !allowed(tenant, { arrangement: ['manage'] })) {
    return fail(c, 403, 'Only its owner or an editor can change this arrangement')
  }
  if (!existing && c.req.method === 'DELETE') return fail(c, 404, 'not found')
  if (!existing && !allowed(tenant, { arrangement: ['create'] })) return fail(c, 403, 'forbidden')
  c.set('arrangement', existing)
  await next()
})
/** "2026-11-12T01-45-14-726Z.json" -> ISO time, or undefined */
function timeFromFile(file: string): string | undefined {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3}Z)\.json$/.exec(file)
  return m ? `${m[1]}:${m[2]}:${m[3]}.${m[4]}` : undefined
}
export const songs = new Hono<AppEnv>({ strict: false })
  .use(church, sameOrigin)
  .use('/index.json', only('GET'))
  .get('/index.json', need({ song: ['read'] }), async (c) => {
    c.header('Cache-Control', 'private, no-cache')
    return c.json(await data.listSongs(c.get('deps').db, c.get('tenant').orgId))
  })
  .use('/new', only('POST'))
  .post('/new', need({ song: ['create'] }), body(newSong), async (c) => {
    const { user, orgId } = c.get('tenant')
    const song = await data.createSong(c.get('deps').db, orgId, user.id, c.req.valid('json').title)
    if (song === 'exists') return fail(c, 409, 'A song with this name exists already')
    return c.json(song, 201)
  })
  .use(`${SONG}/*`, songOwned)
  .use(SONG, only('PATCH', 'DELETE'))
  .patch(SONG, need({ content: ['edit'] }), body(songPatch), async (c) => {
    const song = await data.updateSong(c.get('deps').db, c.get('tenant').orgId, c.req.param('songId'), c.req.valid('json'))
    if (song === 'exists') return fail(c, 409, 'A song with this name exists already')
    if (!song) return fail(c, 404, 'not found')
    return c.json(song)
  })
  .delete(SONG, need({ song: ['delete'] }), async (c) => {
    const { orgId } = c.get('tenant')
    const songId = c.req.param('songId')
    const prefix = songPrefix(orgId, songId)
    if (!prefix || !(await data.deleteSong(c.get('deps').db, orgId, songId, c.get('deps').memo))) return fail(c, 404, 'not found')
    let cursor: string | undefined
    do {
      const page = await c.env.FILES.list({ prefix, cursor, limit: 1000 })
      if (page.objects.length > 0) await c.env.FILES.delete(page.objects.map((o) => o.key))
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
    return c.body(null, 204)
  })
  .get(`${SONG}/arrangements`, async (c) => c.json(await data.listArrangements(c.get('deps').db, c.get('tenant').orgId, c.req.param('songId'))))
  .get(ARRANGEMENT, async (c) => {
    const songId = c.req.param('songId')
    const id = arrangementId(c)
    const row = id ? await data.getArrangement(c.get('deps').db, c.get('tenant').orgId, songId, id) : null
    return row ? c.json(stored(row, songId)) : fail(c, 404, 'not found')
  })
  .put(ARRANGEMENT, arrangementWrite, maxBody(ARRANGEMENT_MAX_BYTES, 'Arrangement too large'), body(arrangementBody), async (c) => {
    const songId = c.req.param('songId')
    const { id: _id, song: _song, owner: _owner, updated: _updated, name, ...rest } = c.req.valid('json')
    const title = (name?.trim() || 'Arrangement').slice(0, 80)
    const { user, orgId } = c.get('tenant')
    const row = await data.saveArrangement(c.get('deps').db, orgId, songId, arrangementId(c)!, user.id, title, rest)
    return row ? c.json(stored(row, songId)) : fail(c, 404, 'not found')
  })
  .delete(ARRANGEMENT, arrangementWrite, async (c) => {
    await data.deleteArrangement(c.get('deps').db, c.get('tenant').orgId, c.req.param('songId'), arrangementId(c)!)
    return c.json({ ok: true as const })
  })
  .all(`${SONG}/arrangements/*`, (c) => fail(c, 404, 'not found'))
  .put(`${SONG}/chart.pro`, need({ content: ['edit'] }), maxBody(CHART_MAX_BYTES, 'Chart too large'), async (c) => {
    const key = songKey(c.get('tenant').orgId, c.req.param('songId'), ['chart.pro'])
    if (!key) return fail(c, 404, 'not found')
    await c.env.FILES.put(key, await c.req.text(), { httpMetadata: { contentType: 'text/plain; charset=utf-8' } })
    return c.body(null, 204)
  })
  .put(`${SONG}/analysis.json`, need({ content: ['edit'] }), maxBody(ANALYSIS_MAX_BYTES, 'Too large'), body(analysisBody), async (c) => {
    const tenant = c.get('tenant')
    const songId = c.req.param('songId')
    const key = songKey(tenant.orgId, songId, ['analysis.json'])
    if (!key) return fail(c, 404, 'not found')
    const current = await c.env.FILES.get(key)
    if (!current) return fail(c, 404, 'not found') // only songs that have been analysed
    const now = new Date().toISOString()
    const previous = current.customMetadata ?? {}
    const historyKey = songKey(tenant.orgId, songId, ['analysis', 'history', `${now.replace(/[:.]/g, '-')}.json`])
    if (!historyKey) return fail(c, 404, 'not found')
    await c.env.FILES.put(historyKey, await current.text(), {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { savedAt: previous.updatedAt ?? current.uploaded.toISOString(), savedBy: previous.updatedBy ?? 'analysis' },
    })
    const editor = (tenant.user.name || tenant.user.email || tenant.user.id).slice(0, 120)
    await c.env.FILES.put(key, JSON.stringify(c.req.valid('json')), {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { updatedAt: now, updatedBy: editor },
    })
    return c.json({ ok: true as const, updatedAt: now })
  })
  .use(`${SONG}/analysis/history`, only('GET'))
  .get(`${SONG}/analysis/history`, async (c) => {
    const dir = songKey(c.get('tenant').orgId, c.req.param('songId'), ['analysis', 'history'])
    if (!dir) return fail(c, 404, 'not found')
    const prefix = `${dir}/`
    const out: { file: string; savedAt: string; savedBy: string }[] = []
    let cursor: string | undefined
    do {
      const page = await c.env.FILES.list({ prefix, cursor, include: ['customMetadata'] })
      for (const o of page.objects) {
        const file = o.key.slice(prefix.length)
        // copied objects can lose their custom metadata (wrangler cannot set it): the file name is the time it was replaced
        out.push({ file, savedAt: o.customMetadata?.savedAt ?? timeFromFile(file) ?? o.uploaded.toISOString(), savedBy: o.customMetadata?.savedBy ?? '' })
      }
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
    out.sort((a, b) => b.file.localeCompare(a.file))
    return c.json(out)
  })
  // GET (and HEAD, which Hono routes here) of any other file of the song
  .get(`${SONG}/*`, need({ song: ['read'] }), async (c) => {
    const path = parseSongPath(new URL(c.req.url).pathname)
    const key = path?.kind === 'song' ? songKey(c.get('tenant').orgId, path.songId, path.rest) : null
    if (!key) return fail(c, 404, 'not found')
    return await serveFile(c.req.raw, c.env, key, executionCtx(c))
  })
  .all(`${SONG}/*`, methodNotAllowed)
