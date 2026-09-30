import { createSocket } from "node:dgram";
import { createConnection } from "node:net";

export function createMagicPacket(mac: string): Buffer {
  const address = Buffer.from(mac.replace(/[:-]/g, ""), "hex");
  if (address.length !== 6) throw new Error("Invalid MAC address");
  const packet = Buffer.alloc(102, 0xff);
  for (let index = 0; index < 16; index++) address.copy(packet, 6 + index * 6);
  return packet;
}

export function sendWakePacket(packet: Buffer, broadcast: string, port: number): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const socket = createSocket("udp4");
  let finished = false;
  const timeout = setTimeout(() => finish(new Error("WOL send timed out")), 2000);
  function finish(error?: Error | null) {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    socket.close();
    if (error) reject(error);
    else resolve();
  }
  socket.once("error", finish);
  socket.bind(0, () => {
    try {
      socket.setBroadcast(true);
      socket.send(packet, port, broadcast, finish);
    } catch (error) {
      finish(error instanceof Error ? error : new Error("WOL send failed"));
    }
  });
  return promise;
}

const unavailableCodes: Record<string, true> = {
  ECONNREFUSED: true,
  ETIMEDOUT: true,
  EHOSTUNREACH: true,
  ENETUNREACH: true,
  ECONNRESET: true,
};

export function probeRdp(host: string, port = 3389, timeoutMs = 1500): Promise<boolean> {
  const { promise, resolve, reject } = Promise.withResolvers<boolean>();
  const socket = createConnection({ host, port });
  let finished = false;
  function finish(ready: boolean, error?: Error) {
    if (finished) return;
    finished = true;
    socket.destroy();
    if (error) reject(error);
    else resolve(ready);
  }
  socket.setTimeout(timeoutMs, () => finish(false));
  socket.once("connect", () => finish(true));
  socket.once("error", (error: NodeJS.ErrnoException) => {
    finish(false, error.code && Object.hasOwn(unavailableCodes, error.code) ? undefined : error);
  });
  return promise;
}
