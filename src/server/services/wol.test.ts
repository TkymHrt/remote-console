import { createSocket } from 'node:dgram'

import { describe, expect, it } from 'vite-plus/test'

import { UdpWakeSender, createMagicPacket } from './wol'

const TEST_MAC = '9C:6B:00:94:06:8A'
const EXPECTED_MAC_BYTES = Buffer.from('9C6B0094068A', 'hex')

function expectValidMagicPacket(packet: Buffer): void {
  expect(packet).toHaveLength(102)
  expect(packet.subarray(0, 6)).toEqual(Buffer.alloc(6, 0xff))
  for (let offset = 6; offset < packet.length; offset += 6) {
    expect(packet.subarray(offset, offset + 6)).toEqual(EXPECTED_MAC_BYTES)
  }
}

describe('Wake-on-LAN', () => {
  it('builds the standard 6-byte prefix and 16 MAC repetitions', () => {
    expectValidMagicPacket(createMagicPacket(TEST_MAC))
    expect(() => createMagicPacket('not-a-mac')).toThrow('Invalid MAC address')
  })

  it('emits the configured number of magic packets over UDP', async () => {
    const receiver = createSocket('udp4')
    const packets: Buffer[] = []
    const received = new Promise<Buffer[]>((resolve, reject) => {
      receiver.once('error', reject)
      receiver.on('message', (packet) => {
        packets.push(packet)
        if (packets.length === 3) resolve(packets)
      })
    })

    await new Promise<void>((resolve, reject) => {
      receiver.once('error', reject)
      receiver.bind(0, '127.0.0.1', resolve)
    })
    const address = receiver.address()

    try {
      const sender = new UdpWakeSender({
        macAddress: TEST_MAC,
        broadcastAddress: '127.0.0.1',
        bindAddress: '127.0.0.1',
        port: address.port,
        packetCount: 3,
        packetIntervalMs: 0,
      })
      await sender.send()
      const receivedPackets = await received
      expect(receivedPackets).toHaveLength(3)
      receivedPackets.forEach(expectValidMagicPacket)
    } finally {
      receiver.close()
    }
  })
})
