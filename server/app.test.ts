import { pcStatusSchema } from "../shared/pc.ts";
import type { webcrypto } from "node:crypto";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { createApp } from "./app.ts";
import { readConfiguration } from "./config.ts";
import { createPcController } from "./pc.ts";

const config = readConfiguration({
  NODE_ENV: "production",
  PUBLIC_ORIGIN: "https://console.example.com",
  PC_IP: "192.168.1.100",
  PC_MAC: "AA:BB:CC:DD:EE:FF",
  WOL_BROADCAST: "192.168.1.255",
  BROWSER_RDP_URL: "https://rdp.example.com/rdp/vnet/192.168.1.100/3389",
  CF_ACCESS_TEAM_DOMAIN: "https://test.cloudflareaccess.com",
  CF_ACCESS_AUD: "dashboard-audience",
});
let signingKey: webcrypto.CryptoKey;
let accessKeys: JWTVerifyGetKey;

beforeAll(async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  signingKey = privateKey;
  const key = await exportJWK(publicKey);
  accessKeys = createLocalJWKSet({ keys: [{ ...key, kid: "test-key", alg: "RS256" }] });
});

async function token(options: { issuer?: string; audience?: string; expiresAt?: number } = {}) {
  return new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setSubject("test-user")
    .setIssuer(options.issuer ?? "https://test.cloudflareaccess.com")
    .setAudience(options.audience ?? "dashboard-audience")
    .setIssuedAt()
    .setExpirationTime(options.expiresAt ?? Math.floor(Date.now() / 1000) + 60)
    .sign(signingKey);
}

function protectedApp() {
  const send = vi.fn(async () => {});
  const pc = createPcController(config, { probe: async () => false, wake: send });
  return { app: createApp(config, pc, { accessKeys }), send };
}

describe("Access-protected HTTP API", () => {
  it("rejects missing, forged, wrong-issuer, wrong-audience, and expired assertions before WOL", async () => {
    const { app, send } = protectedApp();
    const invalid = [
      undefined,
      "forged-token",
      await token({ issuer: "https://other.cloudflareaccess.com" }),
      await token({ audience: "rdp-app-audience" }),
      await token({ expiresAt: Math.floor(Date.now() / 1000) - 1 }),
    ];
    for (const assertion of invalid) {
      const headers: Record<string, string> = { Origin: config.PUBLIC_ORIGIN };
      if (assertion) headers["Cf-Access-Jwt-Assertion"] = assertion;
      expect((await app.request("/api/pc/wake", { method: "POST", headers })).status).toBe(401);
    }
    expect(send).not.toHaveBeenCalled();
    expect((await app.request("/")).status).toBe(401);
  });

  it("rejects cross-origin and origin-less wake requests even with a valid Access JWT", async () => {
    const { app, send } = protectedApp();
    const assertion = await token();
    for (const origin of [undefined, "https://evil.example", "null"]) {
      const headers: Record<string, string> = { "Cf-Access-Jwt-Assertion": assertion };
      if (origin) headers.Origin = origin;
      expect((await app.request("/api/pc/wake", { method: "POST", headers })).status).toBe(403);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("permits the dashboard audience and origin to wake the PC and returns an uncached lifecycle", async () => {
    const { app, send } = protectedApp();
    const assertion = await token();
    const headers = { "Cf-Access-Jwt-Assertion": assertion, Origin: config.PUBLIC_ORIGIN };
    const before = await app.request("/api/pc", { headers });
    expect(before.status).toBe(200);
    expect(pcStatusSchema.parse(await before.json()).state).toBe("offline");
    const wake = await app.request("/api/pc/wake", { method: "POST", headers });
    expect(wake.status).toBe(202);
    expect(pcStatusSchema.parse(await wake.json()).state).toBe("waking");
    expect(wake.headers.get("Cache-Control")).toBe("no-store");
    const status = await app.request("/api/pc", { headers });
    expect(pcStatusSchema.parse(await status.json()).state).toBe("waking");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
