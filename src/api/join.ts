/**
 * /api/join/<token>: joining a church through a link an admin made (links.ts). Open to people who are
 * not signed in; the secret in the link is what names the church and the role.
 *
 *   GET  /api/join/<token>          the church and role, or why the link does not work
 *   POST /api/join/<token>/start    {email}  about to ask for a sign-in code at this address
 *   POST /api/join/<token>/finish            signed in: join the church with the link's role
 *
 * Between start and finish the browser runs the usual sign-in (Better Auth: Turnstile, rate limits,
 * emailed code). `start` is what lets an address without an account get a code and an account, for a
 * few minutes (auth-options.ts, auth.ts). Nobody is added to a church before their code is checked.
 */
import { Hono, type Context } from 'hono'
import * as z from 'zod'
import * as data from './data.ts'
import { fail, sameOrigin, type AppEnv } from './tenant.ts'
import { body, only } from './validate.ts'

const EMAIL_MESSAGE = 'Enter a valid email address'
const start = z.object({
  email: z
    .string({ error: EMAIL_MESSAGE })
    .transform((v) => v.trim().toLowerCase())
    .pipe(z.string().max(254, EMAIL_MESSAGE).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, EMAIL_MESSAGE)),
})

/** What a person sees for a link that does not work (shown as the page's heading). */
const PROBLEMS: Record<data.LinkProblem, string> = {
  missing: "This join link doesn't work",
  off: 'This join link was turned off',
  used: 'This join link was already used',
  expired: 'This join link has expired',
}
// 404 for a link that never existed; 410 for one that did and no longer works
const problem = (c: Context, p: data.LinkProblem) => (p === 'missing' ? fail(c, 404, PROBLEMS[p]) : fail(c, 410, PROBLEMS[p]))

export const join = new Hono<AppEnv>({ strict: false })
  .use(sameOrigin)
  .use('/:token', only('GET'))
  .get('/:token', async (c) => {
    const link = await data.findJoinLink(c.get('deps').db, c.req.param('token'))
    if (typeof link === 'string') return problem(c, link)
    return c.json({ church: link.church, role: link.role, singleUse: link.singleUse })
  })
  .use('/:token/start', only('POST'))
  .post('/:token/start', body(start), async (c) => {
    const { db } = c.get('deps')
    const link = await data.findJoinLink(db, c.req.param('token'))
    if (typeof link === 'string') return problem(c, link)
    await data.addJoinRequest(db, link.id, c.req.valid('json').email)
    return c.json({ ok: true as const })
  })
  .use('/:token/finish', only('POST'))
  .post('/:token/finish', async (c) => {
    const { auth, db } = c.get('deps')
    const session = await auth.api.getSession({ headers: c.req.raw.headers, returnHeaders: true })
    const user = session.response?.user
    if (!user?.email) return fail(c, 401, 'Sign in first')
    const joined = await data.joinWithLink(db, c.req.param('token'), { id: user.id, email: user.email })
    if (typeof joined === 'string') {
      // the link stopped working after the code made their account: do not leave an account in no church
      await data.removePersonIfChurchless(db, user.id, '')
      return problem(c, joined)
    }
    return c.json(joined)
  })
