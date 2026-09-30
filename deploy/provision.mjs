import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const root = fileURLToPath(new URL("../", import.meta.url));
const settings = z
  .object({
    CF_ACCOUNT_ID: z.string().min(1),
    CF_ZONE_NAME: z.string().min(1),
    CF_OWNER_EMAIL: z.email(),
    DASHBOARD_HOSTNAME: z.string().min(1),
    RDP_HOSTNAME: z.string().min(1),
    PC_NAME: z.string().min(1),
    PC_IP: z.ipv4(),
    PC_MAC: z.string().regex(/^(?:[\da-f]{2}:){5}[\da-f]{2}$/i),
    WOL_BROADCAST: z.ipv4(),
    SSH_HOST: z.string().min(1).default("remote-console"),
    TUNNEL_NAME: z.string().min(1).default("remote-console"),
  })
  .parse(process.env);
const tokenPath =
  process.env.CLOUDFLARE_API_TOKEN_FILE ??
  resolve(homedir(), ".config/remote-console/cloudflare-api-token");
const token = (await readFile(tokenPath, "utf8")).trim();
const base = `/accounts/${settings.CF_ACCOUNT_ID}`;
const outputDirectory = resolve(root, ".deploy");
await mkdir(outputDirectory, { recursive: true, mode: 0o700 });

async function api(path, method = "GET", body) {
  const url = new URL(path, "https://api.cloudflare.com/client/v4/");
  url.pathname = `/client/v4${path.split("?")[0]}`;
  const collected = [];
  while (true) {
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok || !data.success)
      throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(data.errors)}`);
    if (method !== "GET" || !Array.isArray(data.result)) return data.result;
    collected.push(...data.result);
    const cursor = data.result_info?.cursors?.after ?? data.result_info?.cursor;
    if (cursor) {
      if (url.searchParams.get("cursor") === cursor)
        throw new Error(`Repeated pagination cursor for ${path}`);
      url.searchParams.set("cursor", cursor);
      continue;
    }
    const page = data.result_info?.page ?? Number(url.searchParams.get("page") ?? 1);
    const totalPages = data.result_info?.total_pages;
    if (totalPages && page < totalPages) {
      url.searchParams.set("page", String(page + 1));
      continue;
    }
    return collected;
  }
}

const zones = await api(
  `/zones?account.id=${settings.CF_ACCOUNT_ID}&name=${settings.CF_ZONE_NAME}`,
);
if (zones.length !== 1) throw new Error("The configured account/zone did not resolve uniquely");
const zone = zones[0];
const organization = await api(`${base}/access/organizations`);
const teamDomain = `https://${organization.auth_domain}`;
const ownerPolicy = {
  name: "Remote Console owner",
  decision: "allow",
  precedence: 1,
  include: [{ email: { email: settings.CF_OWNER_EMAIL } }],
};
const applications = await api(`${base}/access/apps`);
let dashboard = applications.find((app) => app.domain === settings.DASHBOARD_HOSTNAME);
if (!dashboard) {
  dashboard = await api(`${base}/access/apps`, "POST", {
    name: "Remote Console",
    type: "self_hosted",
    domain: settings.DASHBOARD_HOSTNAME,
    destinations: [{ type: "public", uri: settings.DASHBOARD_HOSTNAME }],
    session_duration: "24h",
    policies: [ownerPolicy],
  });
}
const dashboardPolicies = await api(`${base}/access/apps/${dashboard.id}/policies`);
if (
  dashboardPolicies.length !== 1 ||
  dashboardPolicies[0].decision !== "allow" ||
  dashboardPolicies[0].include?.length !== 1 ||
  dashboardPolicies[0].include[0].email?.email !== settings.CF_OWNER_EMAIL
) {
  throw new Error(
    "Dashboard policy differs from the exact-owner policy; refusing to overwrite existing policy",
  );
}

const virtualNetworks = await api(`${base}/teamnet/virtual_networks`);
const virtualNetwork = virtualNetworks.find((network) => network.is_default_network);
if (!virtualNetwork)
  throw new Error(
    "No default virtual network; configure the desired VNET explicitly before provisioning",
  );
const targets = await api(`${base}/infrastructure/targets`);
let target = targets.find(
  (entry) =>
    entry.ip?.ipv4?.ip_addr === settings.PC_IP &&
    entry.ip.ipv4.virtual_network_id === virtualNetwork.id,
);
if (!target) {
  target = await api(`${base}/infrastructure/targets`, "POST", {
    hostname: settings.PC_NAME.toLowerCase(),
    ip: { ipv4: { ip_addr: settings.PC_IP, virtual_network_id: virtualNetwork.id } },
  });
}
let rdp = applications.find((app) => app.domain === settings.RDP_HOSTNAME);
if (!rdp) {
  rdp = await api(`${base}/access/apps`, "POST", {
    name: "Remote Console RDP",
    type: "rdp",
    domain: settings.RDP_HOSTNAME,
    destinations: [{ type: "public", uri: settings.RDP_HOSTNAME }],
    target_criteria: [
      { protocol: "RDP", port: 3389, target_attributes: { hostname: [target.hostname] } },
    ],
    policies: [ownerPolicy],
    session_duration: "24h",
  });
}
if (
  rdp.type !== "rdp" ||
  !rdp.target_criteria?.some(
    (entry) =>
      entry.protocol === "RDP" &&
      entry.port === 3389 &&
      entry.target_attributes?.hostname?.includes(target.hostname),
  )
) {
  throw new Error(
    "Existing browser RDP application does not target this PC on TCP 3389; refusing to overwrite it",
  );
}
const rdpPolicies = await api(`${base}/access/apps/${rdp.id}/policies`);
if (
  !rdpPolicies.some((policy) => policy.decision === "allow") ||
  rdpPolicies.some((policy) => !["allow", "block"].includes(policy.decision))
) {
  throw new Error("Browser RDP requires Allow/Block policies; existing policies were not changed");
}

let tunnels = await api(`${base}/cfd_tunnel?is_deleted=false`);
let tunnel = tunnels.find((entry) => entry.name === settings.TUNNEL_NAME);
let createdTunnel = false;
if (!tunnel) {
  // Use the official generator. Its output may contain connection credentials: never print it.
  execFileSync(
    process.execPath,
    [
      resolve(root, "node_modules/wrangler/bin/wrangler.js"),
      "tunnel",
      "create",
      settings.TUNNEL_NAME,
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        CLOUDFLARE_ACCOUNT_ID: settings.CF_ACCOUNT_ID,
        CLOUDFLARE_API_TOKEN: token,
        CI: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  createdTunnel = true;
  tunnels = await api(`${base}/cfd_tunnel?is_deleted=false`);
  tunnel = tunnels.find((entry) => entry.name === settings.TUNNEL_NAME);
}
if (!tunnel || tunnel.config_src !== "cloudflare")
  throw new Error("Expected a remotely managed Cloudflare Tunnel");
const routes = await api(`${base}/teamnet/routes?is_deleted=false`);
const route = routes.find(
  (entry) =>
    entry.network === `${settings.PC_IP}/32` && entry.virtual_network_id === virtualNetwork.id,
);
if (route && route.tunnel_id !== tunnel.id)
  throw new Error("An existing /32 route belongs to another tunnel; refusing to retarget it");
const dashboardRecords = await api(
  `/zones/${zone.id}/dns_records?name=${encodeURIComponent(settings.DASHBOARD_HOSTNAME)}&per_page=100`,
);
const rdpRecords = await api(
  `/zones/${zone.id}/dns_records?name=${encodeURIComponent(settings.RDP_HOSTNAME)}&per_page=100`,
);
if (dashboardRecords.length > 1 || rdpRecords.length > 1)
  throw new Error("Multiple DNS records match a deployment hostname; refusing to change the RRset");
const dashboardDns = dashboardRecords[0];
const rdpDns = rdpRecords[0];
const tunnelDestination = `${tunnel.id}.cfargotunnel.com`;
if (
  dashboardDns &&
  (dashboardDns.type !== "CNAME" ||
    dashboardDns.content !== tunnelDestination ||
    !dashboardDns.proxied)
)
  throw new Error(
    "Dashboard DNS already belongs to a different destination; refusing to overwrite it",
  );
if (rdpDns && !rdpDns.proxied)
  throw new Error("Browser RDP DNS must be proxied; existing DNS was not changed");

if (createdTunnel) {
  await api(`${base}/cfd_tunnel/${tunnel.id}/configurations`, "PUT", {
    config: {
      ingress: [
        {
          hostname: settings.DASHBOARD_HOSTNAME,
          service: "http://127.0.0.1:3000",
          originRequest: {
            access: {
              required: true,
              teamName: organization.auth_domain.split(".")[0],
              audTag: [dashboard.aud],
            },
          },
        },
        { service: "http_status:404" },
      ],
    },
  });
} else {
  const existing = await api(`${base}/cfd_tunnel/${tunnel.id}/configurations`);
  const ingress = existing.config?.ingress;
  const access = ingress?.[0]?.originRequest?.access;
  if (
    ingress?.length !== 2 ||
    ingress[0].hostname !== settings.DASHBOARD_HOSTNAME ||
    ingress[0].service !== "http://127.0.0.1:3000" ||
    ingress[1].service !== "http_status:404" ||
    access?.required !== true ||
    access.teamName !== organization.auth_domain.split(".")[0] ||
    access.audTag?.length !== 1 ||
    access.audTag[0] !== dashboard.aud
  ) {
    throw new Error(
      "Existing tunnel configuration is not the dedicated protected dashboard configuration; refusing to replace it",
    );
  }
  // A compatible existing tunnel is reused without any configuration PUT.
}
if (!route)
  await api(`${base}/teamnet/routes`, "POST", {
    network: `${settings.PC_IP}/32`,
    tunnel_id: tunnel.id,
    virtual_network_id: virtualNetwork.id,
    comment: "Remote Console Windows RDP",
  });
if (!dashboardDns)
  await api(`/zones/${zone.id}/dns_records`, "POST", {
    type: "CNAME",
    name: settings.DASHBOARD_HOSTNAME,
    content: tunnelDestination,
    proxied: true,
    ttl: 1,
  });
if (!rdpDns)
  await api(`/zones/${zone.id}/dns_records`, "POST", {
    type: "A",
    name: settings.RDP_HOSTNAME,
    content: "240.0.0.0",
    proxied: true,
    ttl: 1,
  });

const tunnelToken = await api(`${base}/cfd_tunnel/${tunnel.id}/token`);
if (typeof tunnelToken !== "string" || !tunnelToken)
  throw new Error("Tunnel token was not returned");
const browserRdpUrl = `https://${settings.RDP_HOSTNAME}/rdp/${virtualNetwork.id}/${settings.PC_IP}/3389`;
const applicationEnvironment =
  [
    "NODE_ENV=production",
    "PORT=3000",
    `PUBLIC_ORIGIN=https://${settings.DASHBOARD_HOSTNAME}`,
    `PC_NAME=${JSON.stringify(settings.PC_NAME)}`,
    `PC_IP=${settings.PC_IP}`,
    `PC_MAC=${settings.PC_MAC}`,
    `WOL_BROADCAST=${settings.WOL_BROADCAST}`,
    "WOL_PORT=9",
    "BOOT_TIMEOUT_MS=120000",
    `BROWSER_RDP_URL=${browserRdpUrl}`,
    `CF_ACCESS_TEAM_DOMAIN=${teamDomain}`,
    `CF_ACCESS_AUD=${dashboard.aud}`,
  ].join("\n") + "\n";
await writeFile(resolve(outputDirectory, "application.env"), applicationEnvironment, {
  mode: 0o600,
});
await writeFile(resolve(outputDirectory, "tunnel-token"), `${tunnelToken}\n`, { mode: 0o600 });
const state = {
  accountId: settings.CF_ACCOUNT_ID,
  zoneId: zone.id,
  tunnelId: tunnel.id,
  dashboardAppId: dashboard.id,
  dashboardAud: dashboard.aud,
  rdpAppId: rdp.id,
  dashboardHostname: settings.DASHBOARD_HOSTNAME,
  browserRdpUrl,
  teamDomain,
  targetId: target.id,
  virtualNetworkId: virtualNetwork.id,
  sshHost: settings.SSH_HOST,
};
await writeFile(resolve(outputDirectory, "state.json"), JSON.stringify(state, null, 2) + "\n", {
  mode: 0o600,
});
console.log(`Provisioned ${settings.DASHBOARD_HOSTNAME}; browser RDP ${browserRdpUrl}`);
console.log("Private deployment files written to .deploy; API and Tunnel tokens were not printed.");
