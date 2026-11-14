/**
 * Subscription plans. A church is on one plan; the plan decides what it may spend on Music.AI each UTC month
 * (`aiCents`, whole US cents). There is no payment provider yet: a church is taken to have paid for its plan
 * every month, and its credits start over on the 1st. The platform admin sets the plan with
 * `pnpm churches plan <slug> <plan>`; a church without a row is on the default plan. To add a plan, add an entry.
 */
export const PLANS = {
  /** no Music.AI: people upload their own stems, charts and lyrics */
  free: { name: 'Free', priceCents: 0, aiCents: 0 },
  team: { name: 'Team', priceCents: 2500, aiCents: 2000 },
} as const
export type PlanId = keyof typeof PLANS
export const PLAN_IDS = Object.keys(PLANS) as PlanId[]
export const DEFAULT_PLAN: PlanId = 'free'
export const isPlanId = (value: unknown): value is PlanId => typeof value === 'string' && Object.hasOwn(PLANS, value)
