import { z } from "zod";

export const pcStatusSchema = z.object({
  pc: z.object({
    name: z.string(),
    ip: z.ipv4(),
    rdpPort: z.literal(3389),
    browserRdpUrl: z.url({ protocol: /^https$/ }),
  }),
  state: z.enum(["offline", "waking", "ready", "timeout"]),
  checkedAt: z.iso.datetime(),
  wakeRequestedAt: z.iso.datetime().nullable(),
  bootDeadlineAt: z.iso.datetime().nullable(),
  access: z.enum(["cloudflare-access", "development"]),
});

export type PcStatus = z.infer<typeof pcStatusSchema>;
