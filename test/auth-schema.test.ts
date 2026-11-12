import { describe, expect, it } from 'vitest'
import { getAuthTables } from 'better-auth/db'
import { getTableColumns, type Table } from 'drizzle-orm'
import { authOptions } from '../src/api/auth-options.ts'
import { schema, type Db } from '../src/db/client.ts'

/**
 * Better Auth decides which tables and fields it needs from its options and plugins; the Drizzle schema
 * has to provide every one (plural export names, the field names as TypeScript keys). After upgrading
 * Better Auth or adding a plugin, this test lists what is missing.
 */
describe('Better Auth tables in src/db/schema/auth.ts', () => {
  const options = authOptions({ baseURL: 'http://x.test', secret: 'x'.repeat(32), db: {} as Db, sendCode: () => {}, background: () => {} })
  const expected = getAuthTables(options as never)

  for (const [model, table] of Object.entries(expected)) {
    it(`has ${model} with every field`, () => {
      const drizzleTable = (schema as Record<string, unknown>)[`${table.modelName}s`] as Table | undefined
      expect(drizzleTable, `export "${table.modelName}s" in src/db/schema/auth.ts`).toBeDefined()
      const columns = getTableColumns(drizzleTable!)
      for (const [field, spec] of Object.entries(table.fields as Record<string, { required?: boolean; unique?: boolean }>)) {
        expect(columns[field], `${model}.${field}`).toBeDefined()
        if (spec.required) expect(columns[field].notNull, `${model}.${field} is required`).toBe(true)
        if (spec.unique) expect(columns[field].isUnique, `${model}.${field} is unique`).toBe(true)
      }
    })
  }
})
