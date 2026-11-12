import { text } from 'drizzle-orm/pg-core'
import { newId, type IdKind } from '../../shared/ids.ts'

/** The primary key of a table: `<prefix>_<24 random chars>` (src/shared/ids.ts), made on insert unless given. */
export const pk = (kind: IdKind) =>
  text('id')
    .primaryKey()
    .$defaultFn(() => newId(kind))
