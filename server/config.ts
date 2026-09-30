import { z } from "zod";

const port = z.coerce.number().int().min(1).max(65535);
const httpsUrl = z.url({ protocol: /^https$/ }).refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return !url.username && !url.password;
}, "URLに認証情報を含めないでください");

const configurationSchema = z
  .object({
    NODE_ENV: z.enum(["production", "development"]).default("production"),
    PORT: port.default(3000),
    PUBLIC_ORIGIN: z.url(),
    PC_NAME: z.string().trim().min(1).max(80).default("自宅PC"),
    PC_IP: z.ipv4(),
    PC_MAC: z
      .string()
      .regex(
        /^(?:[\da-f]{2}:){5}[\da-f]{2}$|^(?:[\da-f]{2}-){5}[\da-f]{2}$/i,
        "MACは AA:BB:CC:DD:EE:FF 形式で指定してください",
      ),
    WOL_BROADCAST: z.ipv4(),
    WOL_PORT: port.default(9),
    BOOT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(120000),
    BROWSER_RDP_URL: httpsUrl,
    CF_ACCESS_TEAM_DOMAIN: httpsUrl
      .refine((value) => {
        if (!URL.canParse(value)) return false;
        const url = new URL(value);
        return (
          /^[a-z0-9-]+\.cloudflareaccess\.com$/.test(url.hostname) &&
          url.pathname === "/" &&
          !url.search &&
          !url.hash &&
          !url.port
        );
      }, "https://<team>.cloudflareaccess.com を指定してください")
      .optional(),
    CF_ACCESS_AUD: z.string().trim().min(1).optional(),
  })
  .superRefine((config, context) => {
    if (!URL.canParse(config.PUBLIC_ORIGIN)) return;
    const origin = new URL(config.PUBLIC_ORIGIN);
    const allowedOrigin =
      config.NODE_ENV === "development"
        ? origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname)
        : origin.protocol === "https:";
    if (
      !allowedOrigin ||
      origin.pathname !== "/" ||
      origin.search ||
      origin.hash ||
      origin.username ||
      origin.password
    ) {
      context.addIssue({
        code: "custom",
        path: ["PUBLIC_ORIGIN"],
        message: "公開HTTPS origin（開発時のみlocalhostのHTTP）を指定してください",
      });
    }
    if (config.NODE_ENV === "production") {
      for (const field of ["CF_ACCESS_TEAM_DOMAIN", "CF_ACCESS_AUD"] as const) {
        if (!config[field])
          context.addIssue({
            code: "custom",
            path: [field],
            message: "本番環境ではCloudflare Accessの設定が必須です",
          });
      }
    }
  });

export type Configuration = z.infer<typeof configurationSchema>;

export function readConfiguration(environment: NodeJS.ProcessEnv = process.env): Configuration {
  const result = configurationSchema.safeParse(environment);
  if (!result.success) {
    throw new Error(
      `設定エラー:\n${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n")}`,
    );
  }
  return result.data;
}
