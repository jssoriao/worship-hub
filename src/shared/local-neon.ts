/**
 * Lets Neon's serverless driver (WebSockets) reach a plain Postgres on this machine.
 *
 * The driver does not speak the Postgres wire protocol directly: it needs a WebSocket proxy in front
 * of the database. Neon runs one for you; for a local database `docker-compose.local.yml` starts one
 * next to Postgres. When a connection URL points at localhost, this points the driver at that proxy.
 * Any other URL (Neon, production) is left alone.
 *
 * Only the Postgres of docker-compose.local.yml is supported: the proxy talks to it by its name inside
 * the compose network. A Postgres started another way (Homebrew, Postgres.app) is not reached.
 * If port 5433 is taken, set LOCAL_DB_PROXY_PORT in .dev.vars; `pnpm db:local` uses the same value.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

const DEFAULT_PROXY_PORT = '5433'

/** Where the proxy of docker-compose.local.yml listens, and the database's name inside the compose network. */
export function localProxy(): string {
  const port = (typeof process !== 'undefined' ? process.env?.LOCAL_DB_PROXY_PORT : undefined) || DEFAULT_PROXY_PORT
  return `localhost:${/^\d{2,5}$/.test(port) ? port : DEFAULT_PROXY_PORT}/v1?address=postgres:5432`
}

export function isLocalDb(url: string | undefined): boolean {
  try {
    return !!url && LOCAL_HOSTS.has(new URL(url).hostname)
  } catch {
    return false
  }
}

/** The settings of Neon's `neonConfig` that matter here. */
interface NeonSettings {
  wsProxy: unknown
  useSecureWebSocket: boolean
  pipelineTLS: boolean
  pipelineConnect: false | 'password'
}

/** Call once with the config and the URL(s) in use; does nothing unless one of them is a local database. */
export function routeLocalDb(config: NeonSettings, ...urls: (string | undefined)[]): void {
  if (!urls.some(isLocalDb)) return
  const proxy = localProxy()
  config.wsProxy = () => proxy
  config.useSecureWebSocket = false
  config.pipelineTLS = false
  config.pipelineConnect = false
}
