import { z } from 'zod'

const optionalTrimmedString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
)

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    SERVER_HOST: z.string().trim().min(1).default('127.0.0.1'),
    SERVER_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    TARGET_NAME: z.string().trim().min(1).max(80).default('自宅PC'),
    TARGET_IP: z.ipv4().default('192.168.11.3'),
    TARGET_MAC: z
      .string()
      .trim()
      .regex(/^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/)
      .transform((value) => value.toUpperCase())
      .default('9C:6B:00:94:06:8A'),
    WOL_BROADCAST_ADDRESS: z.ipv4().default('192.168.11.255'),
    WOL_BIND_ADDRESS: z.ipv4().default('0.0.0.0'),
    WOL_PORT: z.coerce.number().int().min(1).max(65_535).default(9),
    WOL_PACKET_COUNT: z.coerce.number().int().min(1).max(5).default(3),
    WOL_PACKET_INTERVAL_MS: z.coerce.number().int().min(0).max(2_000).default(100),
    RDP_PORT: z.coerce.number().int().min(1).max(65_535).default(3389),
    RDP_URL: z
      .url()
      .refine((value) => new URL(value).protocol === 'https:', 'RDP_URL must use HTTPS')
      .default(
        'https://rdp.tkymhrt.dpdns.org/rdp/1d2a8e0b-3bf8-4c62-bba1-5a797e224c58/192.168.11.3/3389',
      ),
    RDP_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(1_500),
    RDP_PROBE_CACHE_MS: z.coerce.number().int().min(0).max(10_000).default(1_000),
    STARTUP_TIMEOUT_SECONDS: z.coerce.number().int().min(30).max(900).default(180),
    WAKE_COOLDOWN_SECONDS: z.coerce.number().int().min(10).max(3_600).default(60),
    API_RATE_LIMIT_MAX: z.coerce.number().int().min(10).max(10_000).default(120),
    API_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(10).max(3_600).default(60),
    WAKE_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100).default(5),
    WAKE_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
    ACCESS_JWT_MODE: z.enum(['required', 'disabled']),
    ACCESS_TEAM_DOMAIN: optionalTrimmedString,
    ACCESS_AUD: optionalTrimmedString,
  })
  .superRefine((value, context) => {
    if (value.ACCESS_JWT_MODE !== 'required') return

    if (!value.ACCESS_TEAM_DOMAIN) {
      context.addIssue({
        code: 'custom',
        path: ['ACCESS_TEAM_DOMAIN'],
        message: 'ACCESS_TEAM_DOMAIN is required when Access JWT validation is enabled',
      })
    } else if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(value.ACCESS_TEAM_DOMAIN)) {
      context.addIssue({
        code: 'custom',
        path: ['ACCESS_TEAM_DOMAIN'],
        message: 'ACCESS_TEAM_DOMAIN must be a *.cloudflareaccess.com hostname',
      })
    }

    if (!value.ACCESS_AUD) {
      context.addIssue({
        code: 'custom',
        path: ['ACCESS_AUD'],
        message: 'ACCESS_AUD is required when Access JWT validation is enabled',
      })
    }
  })

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production'
  readonly server: Readonly<{
    host: string
    port: number
  }>
  readonly target: Readonly<{
    name: string
    ip: string
    mac: string
    rdpPort: number
    rdpUrl: string
  }>
  readonly wol: Readonly<{
    broadcastAddress: string
    bindAddress: string
    port: number
    packetCount: number
    packetIntervalMs: number
  }>
  readonly timing: Readonly<{
    rdpConnectTimeoutMs: number
    rdpProbeCacheMs: number
    startupTimeoutMs: number
    wakeCooldownMs: number
  }>
  readonly rateLimit: Readonly<{
    apiMax: number
    apiWindowMs: number
    wakeMax: number
    wakeWindowMs: number
  }>
  readonly access: Readonly<
    { mode: 'disabled' } | { mode: 'required'; teamDomain: string; audience: string }
  >
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const accessMode =
    environment.ACCESS_JWT_MODE ?? (environment.NODE_ENV === 'production' ? 'required' : 'disabled')
  const value = environmentSchema.parse({ ...environment, ACCESS_JWT_MODE: accessMode })

  const access: AppConfig['access'] =
    value.ACCESS_JWT_MODE === 'required'
      ? Object.freeze({
          mode: 'required' as const,
          teamDomain: value.ACCESS_TEAM_DOMAIN!,
          audience: value.ACCESS_AUD!,
        })
      : Object.freeze({ mode: 'disabled' as const })

  return Object.freeze({
    nodeEnv: value.NODE_ENV,
    server: Object.freeze({ host: value.SERVER_HOST, port: value.SERVER_PORT }),
    target: Object.freeze({
      name: value.TARGET_NAME,
      ip: value.TARGET_IP,
      mac: value.TARGET_MAC,
      rdpPort: value.RDP_PORT,
      rdpUrl: value.RDP_URL,
    }),
    wol: Object.freeze({
      broadcastAddress: value.WOL_BROADCAST_ADDRESS,
      bindAddress: value.WOL_BIND_ADDRESS,
      port: value.WOL_PORT,
      packetCount: value.WOL_PACKET_COUNT,
      packetIntervalMs: value.WOL_PACKET_INTERVAL_MS,
    }),
    timing: Object.freeze({
      rdpConnectTimeoutMs: value.RDP_CONNECT_TIMEOUT_MS,
      rdpProbeCacheMs: value.RDP_PROBE_CACHE_MS,
      startupTimeoutMs: value.STARTUP_TIMEOUT_SECONDS * 1_000,
      wakeCooldownMs: value.WAKE_COOLDOWN_SECONDS * 1_000,
    }),
    rateLimit: Object.freeze({
      apiMax: value.API_RATE_LIMIT_MAX,
      apiWindowMs: value.API_RATE_LIMIT_WINDOW_SECONDS * 1_000,
      wakeMax: value.WAKE_RATE_LIMIT_MAX,
      wakeWindowMs: value.WAKE_RATE_LIMIT_WINDOW_SECONDS * 1_000,
    }),
    access,
  })
}
