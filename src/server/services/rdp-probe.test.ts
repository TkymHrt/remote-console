import { createServer } from 'node:net'

import { describe, expect, it } from 'vite-plus/test'

import { TcpRdpProbe } from './rdp-probe'

describe('TcpRdpProbe', () => {
  it('reports an accepting TCP port as ready and a closed port as unavailable', async () => {
    const server = createServer((socket) => socket.end())
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Expected an IPv4 test address')

    const probe = new TcpRdpProbe({
      host: '127.0.0.1',
      port: address.port,
      timeoutMs: 500,
      cacheMs: 1_000,
    })
    const ready = await probe.check(true)
    expect(ready.available).toBe(true)

    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
    const offline = await probe.check(true)
    expect(offline.available).toBe(false)
  })
})
