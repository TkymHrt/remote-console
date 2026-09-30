import type { PcStatus } from "../shared/pc.ts";
import type { Configuration } from "./config.ts";
import { createMagicPacket, probeRdp, sendWakePacket } from "./network.ts";

type PcNetwork = { probe: () => Promise<boolean>; wake: () => Promise<void> };

export interface PcController {
  status: () => Promise<PcStatus>;
  wake: () => Promise<PcStatus>;
}

export function createPcController(config: Configuration, network?: PcNetwork): PcController {
  const packet = createMagicPacket(config.PC_MAC);
  const io = network ?? {
    probe: () => probeRdp(config.PC_IP),
    wake: () => sendWakePacket(packet, config.WOL_BROADCAST, config.WOL_PORT),
  };
  let activeWakeAt: number | null = null;
  let lastWakeAt: number | null = null;
  let checkInFlight: Promise<PcStatus> | undefined;
  let wakeInFlight: Promise<PcStatus> | undefined;

  function snapshot(ready: boolean, checkedAt: number): PcStatus {
    if (ready) activeWakeAt = null;
    const deadline = activeWakeAt === null ? null : activeWakeAt + config.BOOT_TIMEOUT_MS;
    return {
      pc: {
        name: config.PC_NAME,
        ip: config.PC_IP,
        rdpPort: 3389,
        browserRdpUrl: config.BROWSER_RDP_URL,
      },
      state: ready
        ? "ready"
        : deadline === null
          ? "offline"
          : Date.now() >= deadline
            ? "timeout"
            : "waking",
      checkedAt: new Date(checkedAt).toISOString(),
      wakeRequestedAt: lastWakeAt === null ? null : new Date(lastWakeAt).toISOString(),
      bootDeadlineAt: deadline === null ? null : new Date(deadline).toISOString(),
      access: config.NODE_ENV === "production" ? "cloudflare-access" : "development",
    };
  }

  function status(): Promise<PcStatus> {
    if (checkInFlight) return checkInFlight;
    checkInFlight = io
      .probe()
      .then((ready) => snapshot(ready, Date.now()))
      .finally(() => {
        checkInFlight = undefined;
      });
    return checkInFlight;
  }

  function wake(): Promise<PcStatus> {
    if (wakeInFlight) return wakeInFlight;
    wakeInFlight = (async () => {
      const current = await status();
      if (current.state === "ready" || current.state === "waking") return current;
      await io.wake();
      activeWakeAt = Date.now();
      lastWakeAt = activeWakeAt;
      return snapshot(false, Date.parse(current.checkedAt));
    })().finally(() => {
      wakeInFlight = undefined;
    });
    return wakeInFlight;
  }

  return { status, wake };
}
