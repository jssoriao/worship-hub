/** The subscription plan of a church (src/shared/plans.ts). A church without a row is on the default plan. */
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { organizations } from './auth.ts'
export const churchPlans = pgTable('church_plans', {
  organizationId: text('organization_id')
    .primaryKey()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  plan: text('plan').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})
