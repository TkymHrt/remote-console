import { z } from 'zod'

const httpsUrlSchema = z.url().refine((value) => new URL(value).protocol === 'https:', {
  message: 'HTTPS URL is required',
})

export const targetStateSchema = z.enum(['offline', 'starting', 'ready', 'error'])
export type TargetState = z.infer<typeof targetStateSchema>

export const targetStatusSchema = z
  .object({
    target: z
      .object({
        name: z.string().min(1).max(80),
      })
      .strict(),
    status: targetStateSchema,
    message: z.string().min(1).max(240),
    checkedAt: z.iso.datetime({ offset: true }),
    lastWakeAt: z.iso.datetime({ offset: true }).nullable(),
    readySince: z.iso.datetime({ offset: true }).nullable(),
    canWake: z.boolean(),
    retryAfterSeconds: z.number().int().nonnegative(),
    connectionUrl: httpsUrlSchema.nullable(),
    errorCode: z.enum(['START_TIMEOUT', 'WOL_SEND_FAILED']).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === 'ready' && value.connectionUrl === null) {
      context.addIssue({
        code: 'custom',
        path: ['connectionUrl'],
        message: 'Ready state requires a connection URL',
      })
    }

    if (value.status !== 'ready' && value.connectionUrl !== null) {
      context.addIssue({
        code: 'custom',
        path: ['connectionUrl'],
        message: 'Connection URL is only available in ready state',
      })
    }

    if (value.status === 'error' && value.errorCode === null) {
      context.addIssue({
        code: 'custom',
        path: ['errorCode'],
        message: 'Error state requires an error code',
      })
    }
  })

export type TargetStatus = z.infer<typeof targetStatusSchema>

export const emptyWakeRequestSchema = z.object({}).strict()

export const apiErrorSchema = z
  .object({
    error: z
      .object({
        code: z.string().min(1),
        message: z.string().min(1),
        requestId: z.string().min(1),
        retryAfterSeconds: z.number().int().positive().optional(),
      })
      .strict(),
  })
  .strict()

export type ApiErrorResponse = z.infer<typeof apiErrorSchema>
