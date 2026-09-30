import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { JWTVerifyGetKey } from "jose";
import { cloudflareAccess } from "./access.ts";
import type { Configuration } from "./config.ts";
import type { PcController } from "./pc.ts";

export function createApp(
  config: Configuration,
  pc: PcController,
  options: { staticRoot?: string; accessKeys?: JWTVerifyGetKey } = {},
) {
  const app = new Hono();
  app.use(
    "*",
    secureHeaders({
      xFrameOptions: "DENY",
      contentSecurityPolicy:
        config.NODE_ENV === "production"
          ? {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'"],
              fontSrc: ["'self'"],
              imgSrc: ["'self'", "data:"],
              connectSrc: ["'self'"],
              baseUri: ["'none'"],
              objectSrc: ["'none'"],
              formAction: ["'self'"],
              frameAncestors: ["'none'"],
            }
          : undefined,
    }),
  );
  app.use("*", async (context, next) => {
    context.header("Cache-Control", "no-store");
    await next();
  });
  if (config.NODE_ENV === "production") app.use("*", cloudflareAccess(config, options.accessKeys));
  app.use("/api/*", async (context, next) => {
    if (
      context.req.method === "POST" &&
      context.req.header("Origin") !== new URL(config.PUBLIC_ORIGIN).origin
    ) {
      return context.json({ error: "このサイトからの操作のみ受け付けます。" }, 403);
    }
    await next();
  });

  app.get("/api/pc", async (context) => {
    try {
      return context.json(await pc.status());
    } catch (error) {
      console.error("RDP probe failed", error);
      return context.json(
        {
          error: "RDPポートを確認できません。LXCのネットワーク設定を確認して、再確認してください。",
        },
        503,
      );
    }
  });
  app.post("/api/pc/wake", async (context) => {
    try {
      const status = await pc.wake();
      return context.json(status, status.state === "waking" ? 202 : 200);
    } catch (error) {
      console.error("Wake request failed", error);
      return context.json(
        { error: "起動要求に失敗しました。LXCからPCへの通信を確認して、再送してください。" },
        502,
      );
    }
  });
  app.all("/api/*", (context) => context.json({ error: "APIが見つかりません。" }, 404));
  if (options.staticRoot) app.get("*", serveStatic({ root: options.staticRoot }));
  app.notFound((context) => context.json({ error: "ページが見つかりません。" }, 404));
  return app;
}
