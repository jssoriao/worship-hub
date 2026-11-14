/**
 * /api/church/services: the active church's services and their setlists. Everyone in the church reads
 * them; editors, admins and owners (`service:plan`) write.
 *
 *   GET    /api/church/services                    [{ id, date, time, title, notes, songs }], newest first
 *   POST   /api/church/services                    {date, time?, title?, notes?}
 *   GET    /api/church/services/<id>               the service and its items, in order
 *   PATCH  /api/church/services/<id>               any of the fields above
 *   DELETE /api/church/services/<id>
 *   POST   /api/church/services/<id>/clone        {date, time?}: a copy with the same title, notes and setlist
 *   PUT    /api/church/services/<id>/items         {items: [...]}: the whole setlist, in order (see data.saveItems)
 *
 * A line is `{ id?, kind?, ... }` where kind is `song` (the default when a song is given), `item` (a plain
 * line: prayer, offering, announcement; needs a `title`) or `header` (groups the lines under it; needs a
 * `title`, takes no key, notes or links). A song line is `{ songId, key?, notes?, links? }`, or
 * `{ newSong: { title, artist?, key? } }` to add a chart-only song to the church's list at the same time.
 * Date and time are wall-clock values (`YYYY-MM-DD`, `HH:MM`), no time zone.
 */
import { Hono } from 'hono'
import * as z from 'zod'
import { isId } from '../shared/ids.ts'
import * as data from './data.ts'
import { church, fail, need, sameOrigin, type AppEnv } from './tenant.ts'
import { body, only } from './validate.ts'
const TITLE_MAX = 120
const NOTES_MAX = 1000
const MAX_ITEMS = 60
const MAX_LINKS = 10
const text = (max: number) =>
  z
    .string()
    .nullable()
    .transform((v) => (v === null ? null : v.trim().slice(0, max) || null))
const dateText = z
  .string({ error: 'Pick a date' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`)
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v)
  }, 'Pick a real date')
const timeText = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 09:30')
  .nullable()
const fields = {
  date: dateText,
  time: timeText,
  title: text(TITLE_MAX),
  notes: text(NOTES_MAX),
}
const newService = z.object({ date: fields.date, time: fields.time.optional().default(null), title: fields.title.optional().default(null), notes: fields.notes.optional().default(null) })
const servicePatch = z.object({ date: fields.date.optional(), time: fields.time.optional(), title: fields.title.optional(), notes: fields.notes.optional() })
const cloneInput = z.object({ date: fields.date, time: fields.time.optional().default(null) })
/** Links are web addresses only (https), so a link can never run script or open a file. */
const link = z.object({
  url: z
    .string({ error: 'A link needs an address' })
    .trim()
    .max(500, 'That link is too long')
    .refine((v) => {
      try {
        return new URL(v).protocol === 'https:'
      } catch {
        return false
      }
    }, 'Links must start with https://'),
  label: z
    .string()
    .default('')
    .transform((v) => v.trim().slice(0, 100)),
})
const item = z
  .object({
    id: z.string().optional(),
    kind: z.enum(['song', 'item', 'header']).optional(),
    songId: z.string().nullable().optional(),
    newSong: z.object({ title: z.string().trim().min(1, 'Give the song a title').max(TITLE_MAX), artist: text(TITLE_MAX).optional(), key: text(12).optional() }).optional(),
    title: text(TITLE_MAX).optional(),
    key: text(12).optional().default(null),
    notes: text(NOTES_MAX).optional().default(null),
    links: z.array(link).max(MAX_LINKS, 'Too many links on one song').optional().default([]),
  })
  .refine((v) => (v.kind === 'item' || v.kind === 'header' ? Boolean(v.title) : Boolean(v.songId) || Boolean(v.newSong) || Boolean(v.title)), {
    message: 'Give every line a name or a song',
  })
const setlist = z.object({ items: z.array(item).max(MAX_ITEMS, 'That is a long setlist') })
const SERVICE = '/:serviceId'
const taken = 'There is already a service at that date and time'
export const servicesApp = new Hono<AppEnv>({ strict: false })
  .use(church, sameOrigin)
  .use('/', only('GET', 'POST'))
  .get('/', need({ service: ['read'] }), async (c) => c.json({ services: await data.listServices(c.get('deps').db, c.get('tenant').orgId) }))
  .post('/', need({ service: ['plan'] }), body(newService), async (c) => {
    const tenant = c.get('tenant')
    const made = await data.createService(c.get('deps').db, tenant.orgId, tenant.user.id, c.req.valid('json'))
    if (made === 'taken') return fail(c, 409, taken)
    return c.json({ service: made }, 201)
  })
  .use(SERVICE, only('GET', 'PATCH', 'DELETE'))
  .get(SERVICE, need({ service: ['read'] }), async (c) => {
    const id = c.req.param('serviceId')
    const service = isId('service', id) ? await data.getService(c.get('deps').db, c.get('tenant').orgId, id) : null
    return service ? c.json({ service }) : fail(c, 404, 'not found')
  })
  .patch(SERVICE, need({ service: ['plan'] }), body(servicePatch), async (c) => {
    const id = c.req.param('serviceId')
    if (!isId('service', id)) return fail(c, 404, 'not found')
    const done = await data.updateService(c.get('deps').db, c.get('tenant').orgId, id, c.req.valid('json'))
    if (done === 'taken') return fail(c, 409, taken)
    return done ? c.json({ service: done }) : fail(c, 404, 'not found')
  })
  .delete(SERVICE, need({ service: ['plan'] }), async (c) => {
    const id = c.req.param('serviceId')
    if (!isId('service', id) || !(await data.deleteService(c.get('deps').db, c.get('tenant').orgId, id))) return fail(c, 404, 'not found')
    return c.json({ ok: true as const })
  })
  .use(`${SERVICE}/clone`, only('POST'))
  .post(`${SERVICE}/clone`, need({ service: ['plan'] }), body(cloneInput), async (c) => {
    const tenant = c.get('tenant')
    const id = c.req.param('serviceId')
    if (!isId('service', id)) return fail(c, 404, 'not found')
    const made = await data.cloneService(c.get('deps').db, tenant.orgId, tenant.user.id, id, c.req.valid('json'))
    if (made === 'taken') return fail(c, 409, taken)
    return made ? c.json({ service: made }, 201) : fail(c, 404, 'not found')
  })
  .use(`${SERVICE}/items`, only('PUT'))
  .put(`${SERVICE}/items`, need({ service: ['plan'] }), body(setlist), async (c) => {
    const tenant = c.get('tenant')
    const { db } = c.get('deps')
    const id = c.req.param('serviceId')
    if (!isId('service', id) || !(await data.serviceBelongs(db, tenant.orgId, id))) return fail(c, 404, 'not found')
    const inputs: data.ItemInput[] = []
    for (const given of c.req.valid('json').items) {
      const kind = given.kind ?? 'song'
      let songId = kind === 'song' ? (given.songId ?? null) : null
      if (kind === 'song' && given.newSong) {
        const made = await data.createSong(db, tenant.orgId, tenant.user.id, given.newSong.title, { artist: given.newSong.artist ?? null, key: given.newSong.key ?? null })
        if (made === 'exists') {
          const archived = await data.titleIsArchived(db, tenant.orgId, given.newSong.title)
          return fail(c, 409, archived ? `“${given.newSong.title}” is in the archive. An admin can restore it.` : `“${given.newSong.title}” is already in the song list. Pick it from the list.`)
        }
        songId = made.id
      }
      if (songId && !isId('song', songId)) return fail(c, 400, 'That song is not in this church')
      inputs.push({ id: given.id, kind, songId, title: given.title ?? null, key: given.key, notes: given.notes, links: given.links })
    }
    const saved = await data.saveItems(db, tenant.orgId, id, inputs)
    if (saved === 'song') return fail(c, 400, 'That song is not in this church')
    if (saved === 'item') return fail(c, 400, 'The same line is listed twice')
    return saved ? c.json({ service: saved }) : fail(c, 404, 'not found')
  })
