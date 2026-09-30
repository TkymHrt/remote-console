import { serve } from "@hono/node-server";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";
import { readConfiguration } from "./config.ts";
import { createPcController } from "./pc.ts";

const config = readConfiguration();
const app = createApp(config, createPcController(config), {
  staticRoot: fileURLToPath(new URL("../client/", import.meta.url)),
});
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: config.PORT }, (info) => {
  console.log(`Remote Console listening on http://127.0.0.1:${info.port}`);
  if (config.NODE_ENV === "development")
    console.warn("Development only: Cloudflare Access validation is disabled.");
});

function shutdown() {
  server.close((error) => {
    if (error) console.error("Shutdown failed", error);
    process.exit(error ? 1 : 0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
