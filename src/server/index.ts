import { fileURLToPath } from 'node:url'

import { serve } from '@hono/node-server'

import { createApp } from './app'
import { loadConfig } from './config'
import { TcpRdpProbe } from './services/rdp-probe'
import { TargetController } from './services/target-controller'
import { UdpWakeSender } from './services/wol'

const config = loadConfig()
const wakeSender = new UdpWakeSender({
  macAddress: config.target.mac,
  broadcastAddress: config.wol.broadcastAddress,
  bindAddress: config.wol.bindAddress,
  port: config.wol.port,
  packetCount: config.wol.packetCount,
  packetIntervalMs: config.wol.packetIntervalMs,
})
const probe = new TcpRdpProbe({
  host: config.target.ip,
  port: config.target.rdpPort,
  timeoutMs: config.timing.rdpConnectTimeoutMs,
  cacheMs: config.timing.rdpProbeCacheMs,
})
const controller = new TargetController({
  targetName: config.target.name,
  rdpUrl: config.target.rdpUrl,
  wakeCooldownMs: config.timing.wakeCooldownMs,
  startupTimeoutMs: config.timing.startupTimeoutMs,
  probe,
  wakeSender,
})
const staticRoot =
  config.nodeEnv === 'production' ? fileURLToPath(new URL('./client', import.meta.url)) : undefined
const app = createApp({ config, controller, ...(staticRoot ? { staticRoot } : {}) })
const server = serve({
  fetch: app.fetch,
  hostname: config.server.host,
  port: config.server.port,
})

console.info(
  JSON.stringify({
    level: 'info',
    event: 'server_started',
    host: config.server.host,
    port: config.server.port,
    target: config.target.name,
    accessJwt: config.access.mode,
  }),
)

let shuttingDown = false
const shutdown = (signal: NodeJS.Signals) => {
  if (shuttingDown) return
  shuttingDown = true
  console.info(JSON.stringify({ level: 'info', event: 'server_stopping', signal }))
  server.close((error) => {
    if (error) {
      console.error(
        JSON.stringify({ level: 'error', event: 'server_stop_failed', message: error.message }),
      )
      process.exitCode = 1
    }
  })
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
