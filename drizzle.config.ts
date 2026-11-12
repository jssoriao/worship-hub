import { defineConfig } from 'drizzle-kit'

// `pnpm db:generate` writes a migration for schema changes; `pnpm db:migrate [--target prod]` applies them.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  strict: true,
  verbose: true,
})
