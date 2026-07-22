export interface RateLimitDecision {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

interface RateLimitEntry {
  count: number
  resetsAt: number
}

interface FixedWindowRateLimiterOptions {
  maxRequests: number
  windowMs: number
  maxIdentities?: number
  clock?: () => number
}

export class FixedWindowRateLimiter {
  readonly #maxRequests: number
  readonly #windowMs: number
  readonly #maxIdentities: number
  readonly #clock: () => number
  readonly #entries = new Map<string, RateLimitEntry>()

  constructor(options: FixedWindowRateLimiterOptions) {
    this.#maxRequests = options.maxRequests
    this.#windowMs = options.windowMs
    this.#maxIdentities = options.maxIdentities ?? 1_000
    this.#clock = options.clock ?? Date.now
  }

  consume(identity: string): RateLimitDecision {
    const now = this.#clock()
    let entry = this.#entries.get(identity)

    if (!entry || entry.resetsAt <= now) {
      if (!entry && this.#entries.size >= this.#maxIdentities) this.#evictExpiredOrOldest(now)
      entry = { count: 0, resetsAt: now + this.#windowMs }
      this.#entries.set(identity, entry)
    }

    if (entry.count >= this.#maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.resetsAt - now) / 1_000)),
      }
    }

    entry.count += 1
    return {
      allowed: true,
      remaining: this.#maxRequests - entry.count,
      retryAfterSeconds: 0,
    }
  }

  #evictExpiredOrOldest(now: number): void {
    for (const [identity, entry] of this.#entries) {
      if (entry.resetsAt <= now) this.#entries.delete(identity)
    }

    if (this.#entries.size < this.#maxIdentities) return
    const oldestIdentity = this.#entries.keys().next().value as string | undefined
    if (oldestIdentity !== undefined) this.#entries.delete(oldestIdentity)
  }
}
