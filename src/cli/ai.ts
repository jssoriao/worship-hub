/**
 * Music.AI credits, for the platform admin. Churches spend credits when their owners generate with Music.AI;
 * a church has a monthly limit (default $10) and all churches together a cap (default $30). Months are UTC calendar months.
 *
 *   pnpm ai usage [--month-of <yyyy-mm-dd>]                 this month: the platform and every church
 *   pnpm ai jobs --church <slug>                             the church's latest jobs (id, piece, status, estimate)
 *   pnpm ai limit <slug> <dollars|default>                   a church's monthly limit ("default" removes its own)
 *   pnpm ai cap <dollars>                                    the monthly cap over all churches
 *   pnpm ai actual <jobId> <dollars>                         what a job really cost, from the Music.AI dashboard
 *
 * Add --target prod to act on the production database (default is the Neon dev database).
 */
import { aiReport, aiUsage, listAiJobs, setAiActual, setAiLimit, setPlatformCap } from '../api/data.ts'
import { openDb } from '../db/client.ts'
import { dollars } from '../shared/ai-pieces.ts'
import { parseArgs, parseSlug } from './lib/cli.ts'
import { loadTarget, splitTarget } from './lib/env.ts'
import { parseDollars } from './lib/money.ts'
import { churchBySlug } from './lib/songs-db.ts'

const { target, rest } = splitTarget(process.argv.slice(2))
const { positional, flags } = parseArgs(rest, ['church', 'month-of'])
const [command, ...args] = positional
const fail = (message: string): never => {
  console.error(message)
  process.exit(1)
}
if (!['usage', 'jobs', 'limit', 'cap', 'actual'].includes(command ?? '')) {
  fail('Usage:\n  pnpm ai usage\n  pnpm ai jobs --church <slug>\n  pnpm ai limit <slug> <dollars|default>\n  pnpm ai cap <dollars>\n  pnpm ai actual <jobId> <dollars>\n(add --target prod for production)')
}
const { db, close } = openDb(loadTarget(target))
try {
  if (command === 'usage') {
    const at = typeof flags['month-of'] === 'string' ? new Date(`${flags['month-of']}T00:00:00Z`) : new Date()
    if (Number.isNaN(at.getTime())) fail('--month-of takes a date like 2026-11-01')
    const r = await aiReport(db, at)
    console.log(`${r.month} (UTC): all churches ${dollars(r.platform.usedCents)} of the ${dollars(r.platform.capCents)} cap${r.platform.paused ? '  PAUSED: the cap is reached' : ''}`)
    for (const c of r.churches) console.log(`  ${c.slug.padEnd(20)} ${dollars(c.usedCents).padStart(8)} of ${dollars(c.limitCents)}`)
  } else if (command === 'jobs') {
    const church = (await churchBySlug(db, parseSlug(flags.church === true ? undefined : flags.church))) ?? fail('No such church. pnpm churches list')
    const jobs = await listAiJobs(db, church.id, 30)
    if (jobs.length === 0) console.log('No jobs yet.')
    for (const j of jobs) {
      console.log(`${j.createdAt.slice(0, 16).replace('T', ' ')}  ${j.id}  ${j.piece.padEnd(18)} ${j.status.padEnd(9)} est ${dollars(j.estimatedCents)}${j.actualCents === null ? '' : ` actual ${dollars(j.actualCents)}`}  ${j.song ?? ''}  ${j.by ?? ''}`)
    }
  } else if (command === 'limit') {
    const church = (await churchBySlug(db, parseSlug(args[0]))) ?? fail('No such church. pnpm churches list')
    if (args[1] === 'default') await setAiLimit(db, church.id, null)
    else await setAiLimit(db, church.id, parseDollars(args[1]))
    const u = await aiUsage(db, church.id)
    console.log(`${church.slug}: ${dollars(u.limitCents)} a month${args[1] === 'default' ? ' (the default)' : ''}; ${dollars(u.usedCents)} used in ${u.month}.`)
  } else if (command === 'cap') {
    await setPlatformCap(db, parseDollars(args[0]))
    console.log(`The cap over all churches is now ${dollars(parseDollars(args[0]))} a month.`)
  } else if (command === 'actual') {
    const cents = parseDollars(args[1])
    if (!(await setAiActual(db, args[0] ?? '', cents))) fail(`No job ${args[0]}. pnpm ai jobs --church <slug>`)
    console.log(`${args[0]}: actual cost ${dollars(cents)}.`)
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
} finally {
  await close()
}
