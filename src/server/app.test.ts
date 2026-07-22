import { describe, expect, it, vi } from 'vite-plus/test'

import type { TargetStatus } from '@/shared/contracts'

import { createApp } from './app'
import { loadConfig } from './config'

const OFFLINE_STATUS: TargetStatus = {
  target: { name: '自宅PC' },
  status: 'offline',
  message: 'PCは停止中です。準備ができたら起動してください。',
  checkedAt: '2026-07-22T12:00:00.000Z',
  lastWakeAt: null,
  readySince: null,
  canWake: true,
  retryAfterSeconds: 0,
  connectionUrl: null,
  errorCode: null,
}

const STARTING_STATUS: TargetStatus = {
  ...OFFLINE_STATUS,
  status: 'starting',
  message: 'Wake-on-LANを送信しました。RDPの応答を待っています。',
  checkedAt: '2026-07-22T12:00:05.000Z',
  lastWakeAt: '2026-07-22T12:00:05.000Z',
  canWake: false,
  retryAfterSeconds: 60,
}

function testConfig(overrides: NodeJS.ProcessEnv = {}) {
  return loadConfig({
    NODE_ENV: 'test',
    ACCESS_JWT_MODE: 'disabled',
    API_RATE_LIMIT_MAX: '120',
    WAKE_RATE_LIMIT_MAX: '5',
    ...overrides,
  })
}

function requestOptions(body: string, origin = 'http://localhost'): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body,
  }
}

describe('HTTP API', () => {
  it('returns a schema-valid status with no-store and browser security headers', async () => {
    const controller = {
      getStatus: vi.fn(async () => OFFLINE_STATUS),
      requestWake: vi.fn(async () => ({ sent: true, status: STARTING_STATUS })),
    }
    const response = await createApp({ config: testConfig(), controller }).request(
      'http://localhost/api/status',
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(OFFLINE_STATUS)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-frame-options')).toBe('DENY')
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(response.headers.get('x-request-id')).toBeTruthy()
  })

  it('rejects client-supplied target values before invoking the wake controller', async () => {
    const controller = {
      getStatus: vi.fn(async () => OFFLINE_STATUS),
      requestWake: vi.fn(async () => ({ sent: true, status: STARTING_STATUS })),
    }
    const app = createApp({ config: testConfig(), controller })
    const attempts: Array<[string, RequestInit]> = [
      ['/api/wake', requestOptions('{"ip":"203.0.113.9"}')],
      ['/api/wake', requestOptions('{"macAddress":"00:11:22:33:44:55"}')],
      ['/api/wake?target=203.0.113.9', requestOptions('{}')],
    ]

    for (const [path, options] of attempts) {
      const response = await app.request(`http://localhost${path}`, options)
      expect(response.status).toBe(400)
      expect(await response.json()).toMatchObject({ error: { code: 'INVALID_REQUEST' } })
    }
    const statusQuery = await app.request('http://localhost/api/status?ip=203.0.113.9')
    expect(statusQuery.status).toBe(400)
    expect(controller.requestWake).not.toHaveBeenCalled()

    const validWake = await app.request('http://localhost/api/wake', requestOptions('{}'))
    expect(validWake.status).toBe(202)
    expect(controller.requestWake).toHaveBeenCalledOnce()
  })

  it('rejects a cross-origin wake request', async () => {
    const controller = {
      getStatus: vi.fn(async () => OFFLINE_STATUS),
      requestWake: vi.fn(async () => ({ sent: true, status: STARTING_STATUS })),
    }
    const response = await createApp({ config: testConfig(), controller }).request(
      'http://localhost/api/wake',
      requestOptions('{}', 'https://attacker.example'),
    )

    expect(response.status).toBe(403)
    expect(controller.requestWake).not.toHaveBeenCalled()
  })

  it('rate-limits status polling and wake operations independently', async () => {
    const statusController = {
      getStatus: vi.fn(async () => OFFLINE_STATUS),
      requestWake: vi.fn(async () => ({ sent: true, status: STARTING_STATUS })),
    }
    const statusApp = createApp({
      config: testConfig({ API_RATE_LIMIT_MAX: '10' }),
      controller: statusController,
    })
    for (let request = 0; request < 10; request += 1) {
      expect((await statusApp.request('http://localhost/api/status')).status).toBe(200)
    }
    const limitedStatus = await statusApp.request('http://localhost/api/status')
    expect(limitedStatus.status).toBe(429)
    expect(limitedStatus.headers.get('retry-after')).toBeTruthy()
    expect(await limitedStatus.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } })

    const wakeController = {
      getStatus: vi.fn(async () => OFFLINE_STATUS),
      requestWake: vi.fn(async () => ({ sent: true, status: STARTING_STATUS })),
    }
    const wakeApp = createApp({
      config: testConfig({ WAKE_RATE_LIMIT_MAX: '1' }),
      controller: wakeController,
    })
    expect((await wakeApp.request('http://localhost/api/wake', requestOptions('{}'))).status).toBe(
      202,
    )
    const limitedWake = await wakeApp.request('http://localhost/api/wake', requestOptions('{}'))
    expect(limitedWake.status).toBe(429)
    expect(await limitedWake.json()).toMatchObject({ error: { code: 'WAKE_RATE_LIMITED' } })
    expect(wakeController.requestWake).toHaveBeenCalledOnce()
  })

  it('returns a safe error envelope without leaking internal details', async () => {
    const controller = {
      getStatus: vi.fn(async () => Promise.reject(new Error('private socket detail'))),
      requestWake: vi.fn(async () => ({ sent: true, status: STARTING_STATUS })),
    }
    const response = await createApp({ config: testConfig(), controller }).request(
      'http://localhost/api/status',
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toMatchObject({ error: { code: 'INTERNAL_ERROR' } })
    expect(JSON.stringify(body)).not.toContain('private socket detail')
  })
})
