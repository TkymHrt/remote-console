import { describe, expect, it } from "vite-plus/test";
import { readConfiguration } from "./config.ts";

const environment = {
  NODE_ENV: "production",
  PUBLIC_ORIGIN: "https://console.example.com",
  PC_IP: "192.168.1.100",
  PC_MAC: "AA:BB:CC:DD:EE:FF",
  WOL_BROADCAST: "192.168.1.255",
  BROWSER_RDP_URL: "https://rdp.example.com/rdp/vnet/192.168.1.100/3389",
  CF_ACCESS_TEAM_DOMAIN: "https://test.cloudflareaccess.com",
  CF_ACCESS_AUD: "dashboard-audience",
};

describe("environment trust boundaries", () => {
  it("fails closed when production Access configuration is absent", () => {
    const missing = { ...environment, CF_ACCESS_TEAM_DOMAIN: undefined, CF_ACCESS_AUD: undefined };
    expect(() => readConfiguration(missing)).toThrow("CF_ACCESS_TEAM_DOMAIN");
    expect(() => readConfiguration(missing)).toThrow("CF_ACCESS_AUD");
  });

  it.each([
    ["PC_IP", "192.168.1.999"],
    ["PC_MAC", "AA:BB:CC:DD:EE"],
    ["WOL_BROADCAST", "example.com"],
    ["WOL_PORT", "65536"],
    ["BOOT_TIMEOUT_MS", "0"],
    ["BROWSER_RDP_URL", "javascript:alert(1)"],
    ["BROWSER_RDP_URL", "not-a-url"],
    ["PUBLIC_ORIGIN", "not-a-url"],
    ["CF_ACCESS_TEAM_DOMAIN", "not-a-url"],
    ["PUBLIC_ORIGIN", "http://console.example.com"],
    ["PUBLIC_ORIGIN", "https://console.example.com/path"],
    ["CF_ACCESS_TEAM_DOMAIN", "https://attacker.example.com"],
  ])("rejects invalid %s: %s", (field, value) => {
    expect(() => readConfiguration({ ...environment, [field]: value })).toThrow(field);
  });

  it("restricts the explicit development bypass to a localhost HTTP origin", () => {
    expect(() => readConfiguration({ ...environment, NODE_ENV: "development" })).toThrow(
      "PUBLIC_ORIGIN",
    );
  });
});
