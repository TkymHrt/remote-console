import { apiErrorSchema, targetStatusSchema } from '@/shared/contracts'
import type { TargetStatus } from '@/shared/contracts'

export class ApiClientError extends Error {
  readonly status: number
  readonly requestId: string | undefined

  constructor(
    message: string,
    options: {
      status: number
      requestId?: string | undefined
      cause?: unknown
    },
  ) {
    super(message, { cause: options.cause })
    this.name = 'ApiClientError'
    this.status = options.status
    this.requestId = options.requestId
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return (await response.json()) as unknown
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiClientError('サーバーから不正な応答を受信しました。', {
      status: response.status,
      cause: error,
    })
  }
}

async function requestStatus(input: RequestInfo | URL, init?: RequestInit): Promise<TargetStatus> {
  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')
  let response: Response
  try {
    response = await fetch(input, {
      ...init,
      credentials: 'same-origin',
      headers,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiClientError('サーバーに接続できません。ネットワークを確認してください。', {
      status: 0,
      cause: error,
    })
  }

  const body = await readJson(response)
  if (!response.ok) {
    const parsedError = apiErrorSchema.safeParse(body)
    if (parsedError.success) {
      throw new ApiClientError(parsedError.data.error.message, {
        status: response.status,
        requestId: parsedError.data.error.requestId,
      })
    }
    throw new ApiClientError('リクエストを処理できませんでした。', {
      status: response.status,
    })
  }

  const parsedStatus = targetStatusSchema.safeParse(body)
  if (!parsedStatus.success) {
    throw new ApiClientError('サーバーの状態応答を検証できませんでした。', {
      status: response.status,
      cause: parsedStatus.error,
    })
  }
  return parsedStatus.data
}

export function fetchTargetStatus(signal?: AbortSignal): Promise<TargetStatus> {
  return requestStatus('/api/status', signal ? { signal } : undefined)
}

export function wakeTarget(): Promise<TargetStatus> {
  return requestStatus('/api/wake', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
}
