export type AppHttpStatus = 400 | 403 | 404 | 409 | 413 | 415 | 429 | 500 | 502

export class AppError extends Error {
  readonly code: string
  readonly httpStatus: AppHttpStatus
  readonly retryAfterSeconds: number | undefined

  constructor(
    code: string,
    message: string,
    httpStatus: AppHttpStatus,
    retryAfterSeconds?: number,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'AppError'
    this.code = code
    this.httpStatus = httpStatus
    this.retryAfterSeconds = retryAfterSeconds
  }
}
