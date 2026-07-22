import { createSocket } from 'node:dgram'

export interface WakeSender {
  send(): Promise<void>
}

export interface UdpWakeSenderOptions {
  macAddress: string
  broadcastAddress: string
  bindAddress: string
  port: number
  packetCount: number
  packetIntervalMs: number
}

export function createMagicPacket(macAddress: string): Buffer {
  const normalized = macAddress.replaceAll(':', '').replaceAll('-', '')
  if (!/^[0-9a-fA-F]{12}$/.test(normalized)) {
    throw new TypeError('Invalid MAC address')
  }

  const macBytes = Buffer.from(normalized, 'hex')
  const packet = Buffer.allocUnsafe(102)
  packet.fill(0xff, 0, 6)
  for (let offset = 6; offset < packet.length; offset += macBytes.length) {
    macBytes.copy(packet, offset)
  }
  return packet
}

export class UdpWakeSender implements WakeSender {
  readonly #options: Readonly<UdpWakeSenderOptions>
  readonly #packet: Buffer

  constructor(options: UdpWakeSenderOptions) {
    this.#options = Object.freeze({ ...options })
    this.#packet = createMagicPacket(options.macAddress)
  }

  send(): Promise<void> {
    const options = this.#options
    const packet = this.#packet

    const { promise, resolve, reject } = Promise.withResolvers<void>()
    const socket = createSocket('udp4')
    let completed = false
    let packetsSent = 0
    let timer: NodeJS.Timeout | undefined

    const closeSocket = (callback: () => void) => {
      try {
        socket.close(callback)
      } catch {
        callback()
      }
    }

    const finish = (error?: Error) => {
      if (completed) return
      completed = true
      clearTimeout(timer)
      socket.removeAllListeners()
      closeSocket(() => {
        if (error) reject(error)
        else resolve()
      })
    }

    const sendNext = () => {
      socket.send(packet, options.port, options.broadcastAddress, (error) => {
        if (error) {
          finish(error)
          return
        }

        packetsSent += 1
        if (packetsSent >= options.packetCount) {
          finish()
          return
        }

        timer = setTimeout(sendNext, options.packetIntervalMs)
      })
    }

    socket.once('error', finish)
    socket.bind({ port: 0, address: options.bindAddress, exclusive: true }, () => {
      try {
        socket.setBroadcast(true)
        sendNext()
      } catch (error) {
        finish(error instanceof Error ? error : new Error('UDP socket setup failed'))
      }
    })

    return promise
  }
}
