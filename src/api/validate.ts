/** Request validation with Zod. A failed check answers 400 with the first issue's message. */
import { zValidator } from '@hono/zod-validator'
import type { ValidationTargets } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type * as z from 'zod'
import { fail } from './tenant.ts'
const check = <S extends z.ZodType, T extends keyof ValidationTargets>(target: T, schema: S) =>
  zValidator(target, schema, (result, c) => {
    if (!result.success) return fail(c, 400, result.error.issues[0]?.message ?? 'Bad Request')
  })
/** A JSON body matching `schema` (the request must say Content-Type: application/json). */
export const body = <S extends z.ZodType>(schema: S) => check('json', schema)
/** Refuses bodies over `bytes` with 413 and `message`, before anything reads them. */
export const maxBody = (bytes: number, message: string) => bodyLimit({ maxSize: bytes, onError: (c) => fail(c, 413, message) })
