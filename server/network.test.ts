import { createSocket } from "node:dgram";
import { once } from "node:events";
import { createServer, type AddressInfo } from "node:net";
import { describe, expect, it } from "vite-plus/test";
import { createMagicPacket, probeRdp, sendWakePacket } from "./network.ts";

describe("LAN transport", () => {
  it("sends the WOL sync sequence and sixteen MAC repetitions over UDP", async () => {
    const receiver = createSocket("udp4");
    receiver.bind(0, "127.0.0.1");
    await once(receiver, "listening");
    try {
      const message = once(receiver, "message");
      await sendWakePacket(
        createMagicPacket("AA-BB-CC-DD-EE-FF"),
        "127.0.0.1",
        receiver.address().port,
      );
      const [packet] = (await message) as [Buffer, unknown];
      expect(packet.toString("hex")).toBe(
        "ffffffffffff" +
          "aabbccddeeffaabbccddeeffaabbccddeeffaabbccddeeff" +
          "aabbccddeeffaabbccddeeffaabbccddeeffaabbccddeeff" +
          "aabbccddeeffaabbccddeeffaabbccddeeffaabbccddeeff" +
          "aabbccddeeffaabbccddeeffaabbccddeeffaabbccddeeff",
      );
    } finally {
      receiver.close();
    }
  });

  it("only needs a TCP accept, not an RDP handshake or Windows login", async () => {
    const server = createServer((socket) => socket.end());
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    try {
      expect(await probeRdp("127.0.0.1", port)).toBe(true);
    } finally {
      const closed = once(server, "close");
      server.close();
      await closed;
    }
    expect(await probeRdp("127.0.0.1", port)).toBe(false);
  });
});
