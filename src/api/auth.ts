import { AsyncLocalStorage } from 'node:async_hooks'
import { Pool, neonConfig } from '@neondatabase/serverless'
import { betterAuth } from 'better-auth'
import { eq } from 'drizzle-orm'
import { dbOver, type Db } from '../db/client.ts'
import { users } from '../db/schema/index.ts'
import { routeLocalDb } from '../shared/local-neon.ts'
import { authOptions } from './auth-options.ts'
import type { Bindings } from './env.ts'
import { sendLoginEmail } from './mail.ts'

/**
 * Workers must not reuse I/O objects (database sockets) across requests, but building the Better Auth
 * instance on every request is wasteful. So the instance is cached per isolate and everything that is
 * request specific (database, waitUntil, secrets) is read from this per-request scope.
 */
type Scope = { db: Db; ctx: ExecutionContext; env: Bindings; tasks: Promise<unknown>[] }
const scope = new AsyncLocalStorage<Scope>()

function current(): Scope {
  const store = scope.getStore()
  if (!store) throw new Error('Auth was used outside withAuth()')
  return store
}

/**
 * The database Better Auth is given: it stands for the current request's database, so the cached
 * instance never holds on to a connection from an earlier request.
 */
const requestDb = new Proxy({} as Db, {
  get(_target, prop) {
    const db = current().db
    const value = Reflect.get(db, prop, db) as unknown
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(db) : value
  },
})

/** Runs a promise after the response is sent; errors are logged without any personal data. */
function background(task: Promise<unknown>) {
  const store = current()
  const safe = task.catch((error: unknown) => {
    console.error('background task failed:', error instanceof Error ? error.message : 'unknown error')
  })
  store.tasks.push(safe)
  store.ctx.waitUntil(safe)
}

async function isMember(db: Db, email: string): Promise<boolean> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.email, email.trim().toLowerCase())).limit(1)
  return rows.length > 0
}

function createAuth(env: Bindings) {
  return betterAuth(
    authOptions({
      baseURL: env.APP_URL,
      secret: env.BETTER_AUTH_SECRET,
      db: requestDb,
      background,
      sendCode: (email, code) => {
        const { env: requestEnv, db } = current()
        // Always answer the same way and send in the background, so neither the response nor its
        // timing reveals whether the address belongs to a member.
        background(
          (async () => {
            if (await isMember(db, email)) await sendLoginEmail(requestEnv, email.trim().toLowerCase(), code)
          })(),
        )
      },
    }),
  )
}

export type Auth = ReturnType<typeof createAuth>

let instance: Auth | undefined

/** Runs `run` with a request-scoped database, then closes its pool once background work is done. */
export async function withAuth<T>(env: Bindings, ctx: ExecutionContext, run: (auth: Auth, db: Db) => Promise<T>): Promise<T> {
  instance ??= createAuth(env)
  // a database on this machine (docker-compose.local.yml) is reached through its WebSocket proxy; Neon and production are untouched
  routeLocalDb(neonConfig, env.DATABASE_URL)
  const pool = new Pool({ connectionString: env.DATABASE_URL })
  // An idle connection whose WebSocket drops makes the pool emit 'error'. Unhandled, that crashes the
  // request (and any email still being sent in the background). The pool replaces the connection itself.
  pool.on('error', (error: Error) => console.error('database pool error:', error.message))
  const db = dbOver(pool)
  const tasks: Promise<unknown>[] = []
  try {
    return await scope.run({ db, ctx, env, tasks }, () => run(instance!, db))
  } finally {
    ctx.waitUntil(Promise.allSettled(tasks).then(() => pool.end()))
  }
}
