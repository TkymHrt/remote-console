import { afterEach, describe, expect, it, vi } from 'vite-plus/test'

import { fetchTargetStatus } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('API response parsing', () => {
  it('preserves cancellation while reading a response body', async () => {
    let body!: ReadableStreamDefaultController<Uint8Array>
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          body = controller
        },
      }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => response),
    )

    const request = fetchTargetStatus()
    body.error(new DOMException('Aborted', 'AbortError'))

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
  })
})
