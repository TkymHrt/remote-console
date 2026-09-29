import { describe, expect, it, vi } from 'vite-plus/test'

import type { ProbeResult, RdpProbe } from './rdp-probe'
import { TargetController } from './target-controller'
import type { WakeSender } from './wol'

const RDP_URL = 'https://rdp.example.test/rdp/fixed-target'

function probeResult(available: boolean, checkedAt: number): ProbeResult {
  return {
    available,
    checkedAt,
  }
}

describe('TargetController', () => {
  it('moves from offline to starting to ready and blocks duplicate wake requests', async () => {
    let now = Date.parse('2026-07-22T12:00:00.000Z')
    let available = false
    const probe: RdpProbe = {
      check: vi.fn(async () => probeResult(available, now)),
    }
    const send = vi.fn(async () => undefined)
    const wakeSender: WakeSender = { send }
    const controller = new TargetController({
      targetName: '自宅PC',
      rdpUrl: RDP_URL,
      wakeCooldownMs: 60_000,
      startupTimeoutMs: 180_000,
      probe,
      wakeSender,
      clock: () => now,
    })

    const offline = await controller.getStatus()
    expect(offline).toMatchObject({ status: 'offline', canWake: true, connectionUrl: null })

    const wake = await controller.requestWake()
    expect(wake.sent).toBe(true)
    expect(wake.status).toMatchObject({ status: 'starting', canWake: false, retryAfterSeconds: 60 })
    expect(send).toHaveBeenCalledOnce()

    await expect(controller.requestWake()).rejects.toMatchObject({
      code: 'WAKE_COOLDOWN',
      httpStatus: 429,
    })
    expect(send).toHaveBeenCalledOnce()

    now += 5_000
    available = true
    const ready = await controller.getStatus(true)
    expect(ready).toMatchObject({
      status: 'ready',
      canWake: false,
      connectionUrl: RDP_URL,
      errorCode: null,
    })
  })

  it('surfaces a startup timeout as a recoverable error state', async () => {
    let now = Date.parse('2026-07-22T12:00:00.000Z')
    const probe: RdpProbe = {
      check: vi.fn(async () => probeResult(false, now)),
    }
    const controller = new TargetController({
      targetName: '自宅PC',
      rdpUrl: RDP_URL,
      wakeCooldownMs: 10_000,
      startupTimeoutMs: 30_000,
      probe,
      wakeSender: { send: vi.fn(async () => undefined) },
      clock: () => now,
    })

    await controller.requestWake()
    now += 30_001
    const failed = await controller.getStatus(true)
    expect(failed).toMatchObject({
      status: 'error',
      errorCode: 'START_TIMEOUT',
      canWake: true,
      connectionUrl: null,
    })
    expect(failed.message).toContain('起動待機時間を超過')
  })

  it('exposes a WOL transmission failure without leaking its cause', async () => {
    const now = Date.parse('2026-07-22T12:00:00.000Z')
    const controller = new TargetController({
      targetName: '自宅PC',
      rdpUrl: RDP_URL,
      wakeCooldownMs: 60_000,
      startupTimeoutMs: 180_000,
      probe: { check: vi.fn(async () => probeResult(false, now)) },
      wakeSender: { send: vi.fn(async () => Promise.reject(new Error('socket detail'))) },
      clock: () => now,
    })

    await expect(controller.requestWake()).rejects.toMatchObject({
      code: 'WOL_SEND_FAILED',
      httpStatus: 502,
      message: 'Wake-on-LANパケットを送信できませんでした。ネットワーク設定を確認してください。',
    })
    const failed = await controller.getStatus(true)
    expect(failed.errorCode).toBe('WOL_SEND_FAILED')
    expect(failed.message).not.toContain('socket detail')
  })
})
