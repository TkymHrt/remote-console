import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'

import type { HttpBindings } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import type { Context } from 'hono'
import { csrf } from 'hono/csrf'
import { HTTPException } from 'hono/http-exception'
import { jwk } from 'hono/jwk'
import { requestId } from 'hono/request-id'
import type { RequestIdVariables } from 'hono/request-id'
import { secureHeaders } from 'hono/secure-headers'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import { apiErrorSchema, emptyWakeRequestSchema, targetStatusSchema } from '@/shared/contracts'

import type { AppConfig } from './config'
import { AppError } from './errors'
import { FixedWindowRateLimiter } from './security/rate-limiter'
import type { TargetControllerApi } from './services/target-controller'

type JwtPayload = { sub?: unknown; email?: unknown } | undefined

type AppEnvironment = {
  Bindings: HttpBindings
  Variables: RequestIdVariables & { jwtPayload: JwtPayload }
}

type AppContext = Context<AppEnvironment>

export interface AppDependencies {
  config: AppConfig
  controller: TargetControllerApi
  staticRoot?: string
  clock?: () => number
}

function hashedRequestIdentity(context: AppContext): string {
  const payload = context.get('jwtPayload')
  const subject = typeof payload?.sub === 'string' ? payload.sub : undefined
  const source =
    subject ??
    context.req.header('cf-connecting-ip') ??
    context.env?.incoming?.socket.remoteAddress ??
    'local'
  return createHash('sha256').update(source).digest('base64url')
}

function errorResponse(context: AppContext, error: unknown): Response {
  const requestIdentifier = context.get('requestId')
  let code = 'INTERNAL_ERROR'
  let message = 'サーバーで問題が発生しました。時間をおいて再試行してください。'
  let status: ContentfulStatusCode = 500
  let retryAfterSeconds: number | undefined

  if (error instanceof AppError) {
    code = error.code
    message = error.message
    status = error.httpStatus
    retryAfterSeconds = error.retryAfterSeconds
  } else if (error instanceof HTTPException) {
    status = error.status
    code = error.status === 401 ? 'ACCESS_UNAUTHORIZED' : 'HTTP_ERROR'
    message =
      error.status === 401
        ? '認証を確認できませんでした。Cloudflare Accessへ再ログインしてください。'
        : 'リクエストを処理できませんでした。'
  }

  const responseBody = apiErrorSchema.parse({
    error: {
      code,
      message,
      requestId: requestIdentifier,
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    },
  })

  context.header('X-Request-Id', requestIdentifier)
  context.header('Cache-Control', 'no-store')
  if (retryAfterSeconds !== undefined) {
    context.header('Retry-After', String(retryAfterSeconds))
  }
  return context.json(responseBody, status)
}

export function createApp(dependencies: AppDependencies): Hono<AppEnvironment> {
  const { config, controller } = dependencies
  const clock = dependencies.clock ?? Date.now
  const apiRateLimiter = new FixedWindowRateLimiter({
    maxRequests: config.rateLimit.apiMax,
    windowMs: config.rateLimit.apiWindowMs,
    clock,
  })
  const wakeRateLimiter = new FixedWindowRateLimiter({
    maxRequests: config.rateLimit.wakeMax,
    windowMs: config.rateLimit.wakeWindowMs,
    clock,
  })
  const app = new Hono<AppEnvironment>()

  app.use(
    '*',
    requestId({
      headerName: '',
      limitLength: 64,
      generator: (context) => context.req.header('cf-ray')?.slice(0, 64) ?? randomUUID(),
    }),
  )
  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        baseUri: ["'none'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        formAction: ["'none'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
      },
      permissionsPolicy: {
        camera: [],
        geolocation: [],
        microphone: [],
        payment: [],
        usb: [],
      },
      referrerPolicy: 'no-referrer',
      strictTransportSecurity: 'max-age=31536000; includeSubDomains',
      xFrameOptions: 'DENY',
    }),
  )
  app.use('*', async (context, next) => {
    const startedAt = performance.now()
    await next()
    context.header('X-Request-Id', context.get('requestId'))

    if (config.nodeEnv !== 'test') {
      console.info(
        JSON.stringify({
          level: 'info',
          event: 'http_request',
          requestId: context.get('requestId'),
          method: context.req.method,
          path: context.req.path,
          status: context.res.status,
          durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
        }),
      )
    }
  })

  app.onError((error, context) => {
    if (config.nodeEnv !== 'test' && !(error instanceof AppError && error.httpStatus < 500)) {
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'request_failed',
          requestId: context.get('requestId'),
          code: error instanceof AppError ? error.code : 'INTERNAL_ERROR',
          message: error.message,
          stack: error.stack,
        }),
      )
    }
    return errorResponse(context, error)
  })

  app.get('/healthz', (context) => {
    context.header('Cache-Control', 'no-store')
    return context.json({ status: 'ok' as const })
  })

  if (config.access.mode === 'required') {
    app.use(
      '/api/*',
      jwk({
        headerName: 'Cf-Access-Jwt-Assertion',
        jwks_uri: `https://${config.access.teamDomain}/cdn-cgi/access/certs`,
        alg: ['RS256'],
        verification: {
          iss: `https://${config.access.teamDomain}`,
          aud: config.access.audience,
        },
      }),
    )
  }

  app.use('/api/*', csrf())
  app.use('/api/wake', async (context, next) => {
    const origin = context.req.header('origin')
    const requestHost = (context.req.header('host') ?? new URL(context.req.url).host).toLowerCase()
    let originHost: string | undefined
    if (origin) {
      try {
        originHost = new URL(origin).host.toLowerCase()
      } catch {
        originHost = undefined
      }
    }

    if (
      (origin !== undefined && (!requestHost || originHost !== requestHost)) ||
      context.req.header('sec-fetch-site') === 'cross-site'
    ) {
      throw new AppError('CSRF_REJECTED', 'この送信元から起動操作は実行できません。', 403)
    }
    await next()
  })
  app.use('/api/*', async (context, next) => {
    context.header('Cache-Control', 'no-store')
    const decision = apiRateLimiter.consume(hashedRequestIdentity(context))
    context.header('X-RateLimit-Remaining', String(decision.remaining))
    if (!decision.allowed) {
      throw new AppError(
        'RATE_LIMITED',
        'リクエストが多すぎます。少し待ってから再試行してください。',
        429,
        decision.retryAfterSeconds,
      )
    }
    await next()
  })

  app.get('/api/status', async (context) => {
    if (new URL(context.req.url).search !== '') {
      throw new AppError('INVALID_REQUEST', 'クエリパラメーターは指定できません。', 400)
    }
    return context.json(targetStatusSchema.parse(await controller.getStatus()))
  })

  app.post(
    '/api/wake',
    bodyLimit({
      maxSize: 1_024,
      onError: (context) =>
        errorResponse(
          context,
          new AppError('BODY_TOO_LARGE', 'リクエスト本体が大きすぎます。', 413),
        ),
    }),
    async (context) => {
      if (new URL(context.req.url).search !== '') {
        throw new AppError('INVALID_REQUEST', 'クエリパラメーターは指定できません。', 400)
      }

      const mediaType = context.req.header('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
      if (mediaType !== 'application/json') {
        throw new AppError(
          'UNSUPPORTED_MEDIA_TYPE',
          'Content-Typeにはapplication/jsonを指定してください。',
          415,
        )
      }

      let body: unknown
      try {
        body = await context.req.json()
      } catch {
        throw new AppError('INVALID_JSON', 'JSON形式が正しくありません。', 400)
      }

      const parsedBody = emptyWakeRequestSchema.safeParse(body)
      if (!parsedBody.success) {
        throw new AppError(
          'INVALID_REQUEST',
          '起動APIに接続先や追加パラメーターは指定できません。',
          400,
        )
      }

      const identity = hashedRequestIdentity(context)
      const decision = wakeRateLimiter.consume(identity)
      if (!decision.allowed) {
        throw new AppError(
          'WAKE_RATE_LIMITED',
          '起動操作の回数が上限に達しました。時間をおいて再試行してください。',
          429,
          decision.retryAfterSeconds,
        )
      }

      const result = await controller.requestWake()
      const status = targetStatusSchema.parse(result.status)
      return context.json(status, result.sent ? 202 : 200)
    },
  )

  app.all('/api/*', (context) =>
    errorResponse(context, new AppError('NOT_FOUND', 'APIが見つかりません。', 404)),
  )

  if (dependencies.staticRoot) {
    const staticRoot = dependencies.staticRoot
    app.use('/assets/*', async (context, next) => {
      await next()
      if (context.res.status < 400) {
        context.header('Cache-Control', 'public, max-age=31536000, immutable')
      }
    })
    app.use('*', serveStatic({ root: staticRoot }))
    app.get('*', serveStatic({ path: path.join(staticRoot, 'index.html') }))
  }

  app.notFound((context) =>
    errorResponse(context, new AppError('NOT_FOUND', 'ページが見つかりません。', 404)),
  )

  return app
}
