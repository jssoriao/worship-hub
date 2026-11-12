/**
 * Which database a script talks to. `--target dev` (default) reads .dev.vars (the Neon dev branch);
 * `--target prod` reads .prod.vars (production). Anything that writes to production must say so.
 *
 * Each file has two logins: DATABASE_URL is the app's (the Worker's; data access only) and
 * DATABASE_OWNER_URL is the owner's, which scripts use because migrations create and alter tables.
 */
import { readFileSync } from 'node:fs'
import { neonConfig } from '@neondatabase/serverless'
import { isLocalDb, routeLocalDb } from '../../shared/local-neon.ts'

export type Target = 'dev' | 'prod'

/** Pulls `--target <dev|prod>` (or `--target=prod`) out of the arguments. */
export function splitTarget(args: string[]): { target: Target; rest: string[] } {
  const rest: string[] = []
  let target: Target = 'dev'
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    let value: string | undefined
    if (a === '--target') value = args[++i]
    else if (a.startsWith('--target=')) value = a.slice('--target='.length)
    else {
      rest.push(a)
      continue
    }
    if (value !== 'dev' && value !== 'prod') {
      console.error('--target must be dev or prod')
      process.exit(1)
    }
    target = value
  }
  return { target, rest }
}

/** KEY=value lines (quotes optional, # comments). */
export function parseVars(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (!m || line.trim().startsWith('#')) continue
    out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2')
  }
  return out
}

/**
 * Loads the variables for a target into process.env (overriding what is there) and returns DATABASE_OWNER_URL.
 * Without the file, DATABASE_OWNER_URL must already be in the environment (how CI runs `--target prod`).
 */
export function loadTarget(target: Target): string {
  const file = target === 'prod' ? '.prod.vars' : '.dev.vars'
  let vars: Record<string, string> = {}
  try {
    vars = parseVars(readFileSync(file, 'utf8'))
  } catch {
    // no file: CI (the deploy workflow) passes DATABASE_OWNER_URL in the environment instead
    if (!process.env.DATABASE_OWNER_URL) {
      console.error(`${file} not found. See .dev.vars.example and docs/infra.md.`)
      process.exit(1)
    }
  }
  // prod variables only supply the database; secrets for dev stay from .dev.vars
  for (const [k, v] of Object.entries(vars)) process.env[k] = v
  const url = process.env.DATABASE_OWNER_URL
  if (!url) {
    console.error(`DATABASE_OWNER_URL (the owner login, for scripts and migrations) is not set in ${file}. See .dev.vars.example.`)
    process.exit(1)
  }
  process.env.WORSHIP_HUB_TARGET = target
  // one login on this machine and the other on Neon would half-work in confusing ways
  if (process.env.DATABASE_URL && isLocalDb(url) !== isLocalDb(process.env.DATABASE_URL)) {
    console.error(`DATABASE_URL and DATABASE_OWNER_URL in ${file} must both point at the local database, or both at Neon.`)
    process.exit(1)
  }
  // a database on this machine (docker-compose.local.yml) is reached through its WebSocket proxy
  routeLocalDb(neonConfig, url, process.env.DATABASE_URL)
  if (target === 'dev') assertDevIsNotProd(url)
  return url
}

/** host + database name: what makes two connection strings the same database. */
export function dbIdentity(url: string): string {
  const u = new URL(url)
  return `${u.host.replace(/-pooler/, '')}${u.pathname}`
}

/** Refuses to run when a dev URL (either login) points at the production database. */
export function assertDevIsNotProd(devUrl: string): void {
  let prod: Record<string, string>
  try {
    prod = parseVars(readFileSync('.prod.vars', 'utf8'))
  } catch {
    return
  }
  const prodIds = [prod.DATABASE_URL, prod.DATABASE_OWNER_URL].filter(Boolean).map(dbIdentity)
  if (prodIds.includes(dbIdentity(devUrl))) {
    console.error('.dev.vars points at the production database. Point it at the Neon development branch (docs/infra.md).')
    process.exit(1)
  }
}
