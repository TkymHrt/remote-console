import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { readConfiguration } from "./config.ts";
import { createPcController } from "./pc.ts";

const config = readConfiguration({
  NODE_ENV: "development",
  PUBLIC_ORIGIN: "http://127.0.0.1:5173",
  PC_IP: "192.168.1.100",
  PC_MAC: "AA:BB:CC:DD:EE:FF",
  WOL_BROADCAST: "192.168.1.255",
  BROWSER_RDP_URL: "https://rdp.example.com/rdp/vnet/192.168.1.100/3389",
  BOOT_TIMEOUT_MS: "1000",
});

afterEach(() => vi.useRealTimers());

describe("PC lifecycle", () => {
  it("moves from offline through waking to ready, then offline when the port closes", async () => {
    let accepting = false;
    const pc = createPcController(config, { probe: async () => accepting, wake: async () => {} });
    expect((await pc.status()).state).toBe("offline");
    expect((await pc.wake()).state).toBe("waking");
    accepting = true;
    const ready = await pc.status();
    expect(ready.state).toBe("ready");
    expect(ready.bootDeadlineAt).toBeNull();
    accepting = false;
    expect((await pc.status()).state).toBe("offline");
  });

  it("coalesces simultaneous wakes and does not extend the boot deadline on duplicate requests", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T00:00:00Z"));
    const sending = Promise.withResolvers<void>();
    const send = vi.fn(() => sending.promise);
    const pc = createPcController(config, { probe: async () => false, wake: send });
    const first = pc.wake();
    const second = pc.wake();
    sending.resolve();
    const [a, b] = await Promise.all([first, second]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(a.bootDeadlineAt).toBe("2026-09-30T00:00:01.000Z");
    expect(b.bootDeadlineAt).toBe(a.bootDeadlineAt);
    vi.setSystemTime(new Date("2026-09-30T00:00:00.500Z"));
    expect((await pc.wake()).bootDeadlineAt).toBe(a.bootDeadlineAt);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("times out at the deadline, permits explicit resend, and recognizes a late ready port", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-30T00:00:00Z"));
    let accepting = false;
    const send = vi.fn(async () => {});
    const pc = createPcController(config, { probe: async () => accepting, wake: send });
    await pc.wake();
    vi.setSystemTime(new Date("2026-09-30T00:00:00.999Z"));
    expect((await pc.status()).state).toBe("waking");
    vi.setSystemTime(new Date("2026-09-30T00:00:01Z"));
    expect((await pc.status()).state).toBe("timeout");
    const resent = await pc.wake();
    expect(resent.state).toBe("waking");
    expect(resent.bootDeadlineAt).toBe("2026-09-30T00:00:02.000Z");
    expect(send).toHaveBeenCalledTimes(2);
    vi.setSystemTime(new Date("2026-09-30T00:00:03Z"));
    expect((await pc.status()).state).toBe("timeout");
    accepting = true;
    expect((await pc.status()).state).toBe("ready");
  });

  it("does not send WOL to an already ready PC", async () => {
    const send = vi.fn(async () => {});
    const pc = createPcController(config, { probe: async () => true, wake: send });
    expect((await pc.wake()).state).toBe("ready");
    expect(send).not.toHaveBeenCalled();
  });

  it("does not claim WOL was sent when UDP sending fails", async () => {
    const pc = createPcController(config, {
      probe: async () => false,
      wake: async () => {
        throw new Error("EACCES");
      },
    });
    await expect(pc.wake()).rejects.toThrow("EACCES");
    const status = await pc.status();
    expect(status.state).toBe("offline");
    expect(status.wakeRequestedAt).toBeNull();
    expect(status.bootDeadlineAt).toBeNull();
  });

  it("does not interpret an unexpected probe error as offline", async () => {
    const send = vi.fn(async () => {});
    const pc = createPcController(config, {
      probe: async () => {
        throw new Error("EACCES");
      },
      wake: send,
    });
    await expect(pc.status()).rejects.toThrow("EACCES");
    await expect(pc.wake()).rejects.toThrow("EACCES");
    expect(send).not.toHaveBeenCalled();
  });
});
