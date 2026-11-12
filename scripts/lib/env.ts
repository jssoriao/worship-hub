/**
 * Which database a script talks to. `--target dev` (default) reads .dev.vars (the Neon dev database);
 * `--target prod` reads .prod.vars (production). Anything that writes to production must say so.
 */
import { readFileSync } from 'node:fs'

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

/** Loads the variables for a target into process.env (overriding what is there) and returns DATABASE_URL. */
export function loadTarget(target: Target): string {
  const file = target === 'prod' ? '.prod.vars' : '.dev.vars'
  let vars: Record<string, string> = {}
  try {
    vars = parseVars(readFileSync(file, 'utf8'))
  } catch {
    if (!process.env.DATABASE_URL || target === 'prod') {
      console.error(`${file} not found. See .dev.vars.example and docs/infra.md.`)
      process.exit(1)
    }
  }
  // prod variables only supply the database; secrets for dev stay from .dev.vars
  for (const [k, v] of Object.entries(vars)) process.env[k] = v
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error(`DATABASE_URL is not set in ${file}.`)
    process.exit(1)
  }
  process.env.WORSHIP_HUB_TARGET = target
  if (target === 'dev') assertDevIsNotProd(url)
  return url
}

/** host + database name: what makes two connection strings the same database. */
export function dbIdentity(url: string): string {
  const u = new URL(url)
  return `${u.host.replace(/-pooler/, '')}${u.pathname}`
}

/** Refuses to run when the dev URL points at the production database. */
export function assertDevIsNotProd(devUrl: string): void {
  let prod: string | undefined
  try {
    prod = parseVars(readFileSync('.prod.vars', 'utf8')).DATABASE_URL
  } catch {
    return
  }
  if (prod && dbIdentity(prod) === dbIdentity(devUrl)) {
    console.error('DATABASE_URL in .dev.vars is the production database. Point it at the Neon dev database (docs/infra.md).')
    process.exit(1)
  }
}
