import { AsyncLocalStorage } from 'node:async_hooks'
import { Pool } from '@neondatabase/serverless'
import { betterAuth } from 'better-auth'
import { PostgresDialect, type PostgresPool, type PostgresPoolClient } from 'kysely'
import { authOptions } from './auth-options.ts'
import type { Bindings } from './env.ts'
import { sendLoginEmail } from './mail.ts'

/**
 * Workers must not reuse I/O objects (database sockets) across requests, but building the Better Auth
 * instance on every request is wasteful. So the instance is cached per isolate and everything that is
 * request specific (database pool, waitUntil, secrets) is read from this per-request scope.
 */
type Scope = { pool: Pool; ctx: ExecutionContext; env: Bindings; tasks: Promise<unknown>[] }
const scope = new AsyncLocalStorage<Scope>()

function current(): Scope {
  const store = scope.getStore()
  if (!store) throw new Error('Auth was used outside withAuth()')
  return store
}

/** Kysely only needs connect() and end(). Both are routed to the current request's pool. */
const requestPool: PostgresPool = {
  options: {},
  // Neon's client is pg-compatible; only its overloaded typings differ from Kysely's minimal interface
  connect: () => current().pool.connect() as unknown as Promise<PostgresPoolClient>,
  end: async () => {},
}

/** Runs a promise after the response is sent; errors are logged without any personal data. */
function background(task: Promise<unknown>) {
  const store = current()
  const safe = task.catch((error: unknown) => {
    console.error('background task failed:', error instanceof Error ? error.message : 'unknown error')
  })
  store.tasks.push(safe)
  store.ctx.waitUntil(safe)
}

async function isMember(pool: Pool, email: string): Promise<boolean> {
  const result = await pool.query('select 1 from "user" where email = $1 limit 1', [email.trim().toLowerCase()])
  return (result.rowCount ?? 0) > 0
}

function createAuth(env: Bindings) {
  return betterAuth(
    authOptions({
      baseURL: env.APP_URL,
      secret: env.BETTER_AUTH_SECRET,
      dialect: new PostgresDialect({ pool: requestPool }),
      background,
      sendCode: (email, code) => {
        const { env: requestEnv, pool } = current()
        // Always answer the same way and send in the background, so neither the response nor its
        // timing reveals whether the address belongs to a member.
        background(
          (async () => {
            if (await isMember(pool, email)) await sendLoginEmail(requestEnv, email.trim().toLowerCase(), code)
          })(),
        )
      },
    }),
  )
}

export type Auth = ReturnType<typeof createAuth>
let instance: Auth | undefined

/** Runs `run` with a request-scoped database pool, then closes the pool once background work is done. */
export async function withAuth<T>(env: Bindings, ctx: ExecutionContext, run: (auth: Auth, pool: Pool) => Promise<T>): Promise<T> {
  instance ??= createAuth(env)
  const pool = new Pool({ connectionString: env.DATABASE_URL })
  // An idle connection whose WebSocket drops makes the pool emit 'error'. Unhandled, that crashes the
  // request (and any email still being sent in the background). The pool replaces the connection itself.
  pool.on('error', (error: Error) => console.error('database pool error:', error.message))
  const tasks: Promise<unknown>[] = []
  try {
    return await scope.run({ pool, ctx, env, tasks }, () => run(instance!, pool))
  } finally {
    ctx.waitUntil(Promise.allSettled(tasks).then(() => pool.end()))
  }
}
