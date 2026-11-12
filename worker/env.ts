/** Bindings, variables and secrets available to the Worker (see wrangler.jsonc and docs/infra.md). */
export type Bindings = {
  /** Private R2 bucket with every church's files, under churches/<churchId>/songs/<songId>/ (see keys.ts). */
  FILES: R2Bucket
  /** Public origin of the app, e.g. https://worshiphub.jssoriao.dev. Overridden in .dev.vars for local runs. */
  APP_URL: string
  /** Sender shown on sign-in emails, e.g. "Worship Hub <login@mail.jssoriao.dev>". */
  MAIL_FROM: string
  /** Secret: signs cookies and tokens. */
  BETTER_AUTH_SECRET: string
  /** Secret: Neon pooled connection string. */
  DATABASE_URL: string
  /** Secret: Resend API key (sending access is enough). */
  RESEND_API_KEY: string
}
