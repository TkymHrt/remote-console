import type { TargetStatus } from '@/shared/contracts'

import { AppError } from '../errors'
import type { ProbeResult, RdpProbe } from './rdp-probe'
import type { WakeSender } from './wol'

const MESSAGE_BY_STATUS: Record<Exclude<TargetStatus['status'], 'error'>, string> = {
  offline: 'PCは停止中です。準備ができたら起動してください。',
  starting: 'Wake-on-LANを送信しました。RDPの応答を待っています。',
  ready: 'RDPへの接続準備が完了しました。',
}

export interface WakeRequestResult {
  sent: boolean
  status: TargetStatus
}

export interface TargetControllerApi {
  getStatus(forceProbe?: boolean): Promise<TargetStatus>
  requestWake(): Promise<WakeRequestResult>
}

interface TargetControllerOptions {
  targetName: string
  rdpUrl: string
  wakeCooldownMs: number
  startupTimeoutMs: number
  probe: RdpProbe
  wakeSender: WakeSender
  clock?: () => number
}

interface ControllerFailure {
  code: 'START_TIMEOUT' | 'WOL_SEND_FAILED'
  message: string
}

export class TargetController implements TargetControllerApi {
  readonly #targetName: string
  readonly #rdpUrl: string
  readonly #wakeCooldownMs: number
  readonly #startupTimeoutMs: number
  readonly #probe: RdpProbe
  readonly #wakeSender: WakeSender
  readonly #clock: () => number

  #lastWakeAt: number | undefined
  #startupBeganAt: number | undefined
  #readySince: number | undefined
  #failure: ControllerFailure | undefined
  #wakeLocked = false

  constructor(options: TargetControllerOptions) {
    this.#targetName = options.targetName
    this.#rdpUrl = options.rdpUrl
    this.#wakeCooldownMs = options.wakeCooldownMs
    this.#startupTimeoutMs = options.startupTimeoutMs
    this.#probe = options.probe
    this.#wakeSender = options.wakeSender
    this.#clock = options.clock ?? Date.now
  }

  async getStatus(forceProbe = false): Promise<TargetStatus> {
    const probeResult = await this.#probe.check(forceProbe)
    return this.#applyProbeResult(probeResult)
  }

  async requestWake(): Promise<WakeRequestResult> {
    const requestTime = this.#clock()
    if (this.#wakeLocked) {
      throw new AppError(
        'WAKE_REQUEST_IN_PROGRESS',
        '起動リクエストを処理中です。しばらくお待ちください。',
        429,
        1,
      )
    }

    const initialCooldown = this.#remainingCooldownSeconds(requestTime)
    if (initialCooldown > 0) {
      throw new AppError(
        'WAKE_COOLDOWN',
        `連続実行を防ぐため、あと${initialCooldown}秒お待ちください。`,
        429,
        initialCooldown,
      )
    }

    this.#wakeLocked = true
    try {
      const current = await this.getStatus(true)
      if (current.status === 'ready') return { sent: false, status: current }
      if (current.status === 'starting') {
        throw new AppError(
          'WAKE_ALREADY_IN_PROGRESS',
          'PCは起動処理中です。RDPの準備完了までお待ちください。',
          409,
        )
      }

      const now = this.#clock()
      const cooldownAfterProbe = this.#remainingCooldownSeconds(now)
      if (cooldownAfterProbe > 0) {
        throw new AppError(
          'WAKE_COOLDOWN',
          `連続実行を防ぐため、あと${cooldownAfterProbe}秒お待ちください。`,
          429,
          cooldownAfterProbe,
        )
      }

      this.#lastWakeAt = now
      this.#startupBeganAt = now
      this.#readySince = undefined
      this.#failure = undefined

      try {
        await this.#wakeSender.send()
      } catch (error) {
        this.#startupBeganAt = undefined
        this.#failure = {
          code: 'WOL_SEND_FAILED',
          message:
            'Wake-on-LANパケットを送信できませんでした。ネットワーク設定を確認してください。',
        }
        throw new AppError('WOL_SEND_FAILED', this.#failure.message, 502, undefined, {
          cause: error,
        })
      }

      return { sent: true, status: this.#buildStatus('starting', now) }
    } finally {
      this.#wakeLocked = false
    }
  }

  #applyProbeResult(result: ProbeResult): TargetStatus {
    if (result.available) {
      this.#readySince ??= result.checkedAt
      this.#startupBeganAt = undefined
      this.#failure = undefined
      return this.#buildStatus('ready', result.checkedAt)
    }

    this.#readySince = undefined
    if (this.#startupBeganAt !== undefined) {
      if (result.checkedAt - this.#startupBeganAt <= this.#startupTimeoutMs) {
        return this.#buildStatus('starting', result.checkedAt)
      }

      this.#startupBeganAt = undefined
      this.#failure = {
        code: 'START_TIMEOUT',
        message: '起動待機時間を超過しました。PCの電源やLAN接続を確認してください。',
      }
    }

    return this.#failure
      ? this.#buildStatus('error', result.checkedAt)
      : this.#buildStatus('offline', result.checkedAt)
  }

  #buildStatus(status: TargetStatus['status'], checkedAt: number): TargetStatus {
    const message =
      status === 'error'
        ? (this.#failure?.message ?? '起動状態を確認できませんでした。')
        : MESSAGE_BY_STATUS[status]
    const cooldown = this.#remainingCooldownSeconds(checkedAt)

    return {
      target: { name: this.#targetName },
      status,
      message,
      checkedAt: new Date(checkedAt).toISOString(),
      lastWakeAt: this.#lastWakeAt === undefined ? null : new Date(this.#lastWakeAt).toISOString(),
      readySince: this.#readySince === undefined ? null : new Date(this.#readySince).toISOString(),
      canWake: (status === 'offline' || status === 'error') && cooldown === 0 && !this.#wakeLocked,
      retryAfterSeconds: cooldown,
      connectionUrl: status === 'ready' ? this.#rdpUrl : null,
      errorCode: status === 'error' ? (this.#failure?.code ?? 'START_TIMEOUT') : null,
    }
  }

  #remainingCooldownSeconds(now: number): number {
    if (this.#lastWakeAt === undefined) return 0
    return Math.max(0, Math.ceil((this.#lastWakeAt + this.#wakeCooldownMs - now) / 1_000))
  }
}
