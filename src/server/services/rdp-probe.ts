import { createConnection } from 'node:net'

export type ProbeFailure = 'timeout' | 'refused' | 'unreachable' | 'unknown'

export interface ProbeResult {
  available: boolean
  checkedAt: number
  latencyMs: number
  failure: ProbeFailure | null
}

export interface RdpProbe {
  check(force?: boolean): Promise<ProbeResult>
}

interface TcpRdpProbeOptions {
  host: string
  port: number
  timeoutMs: number
  cacheMs: number
  clock?: () => number
}

function classifyNetworkError(error: Error & { code?: string }): ProbeFailure {
  if (error.code === 'ECONNREFUSED') return 'refused'
  if (
    error.code === 'EHOSTUNREACH' ||
    error.code === 'ENETUNREACH' ||
    error.code === 'EADDRNOTAVAIL'
  ) {
    return 'unreachable'
  }
  return 'unknown'
}

export function probeTcpPort(
  host: string,
  port: number,
  timeoutMs: number,
  clock: () => number = Date.now,
): Promise<ProbeResult> {
  const { promise, resolve } = Promise.withResolvers<ProbeResult>()
  const startedAt = clock()
  const socket = createConnection({ host, port })
  let settled = false

  const finish = (available: boolean, failure: ProbeFailure | null) => {
    if (settled) return
    settled = true
    socket.destroy()
    const checkedAt = clock()
    resolve({
      available,
      checkedAt,
      latencyMs: Math.max(0, checkedAt - startedAt),
      failure,
    })
  }

  socket.setTimeout(timeoutMs)
  socket.once('connect', () => finish(true, null))
  socket.once('timeout', () => finish(false, 'timeout'))
  socket.once('error', (error: Error & { code?: string }) => {
    finish(false, classifyNetworkError(error))
  })

  return promise
}

export class TcpRdpProbe implements RdpProbe {
  readonly #options: Readonly<Omit<TcpRdpProbeOptions, 'clock'>>
  readonly #clock: () => number
  #cachedResult: ProbeResult | undefined
  #inFlight: Promise<ProbeResult> | undefined

  constructor(options: TcpRdpProbeOptions) {
    this.#options = Object.freeze({
      host: options.host,
      port: options.port,
      timeoutMs: options.timeoutMs,
      cacheMs: options.cacheMs,
    })
    this.#clock = options.clock ?? Date.now
  }

  async check(force = false): Promise<ProbeResult> {
    const now = this.#clock()
    if (
      !force &&
      this.#cachedResult &&
      now - this.#cachedResult.checkedAt < this.#options.cacheMs
    ) {
      return this.#cachedResult
    }

    if (this.#inFlight) return this.#inFlight

    const pending = probeTcpPort(
      this.#options.host,
      this.#options.port,
      this.#options.timeoutMs,
      this.#clock,
    )
    this.#inFlight = pending

    try {
      const result = await pending
      this.#cachedResult = result
      return result
    } finally {
      if (this.#inFlight === pending) this.#inFlight = undefined
    }
  }
}
