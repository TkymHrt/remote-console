import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const privateDirectory = resolve(root, ".deploy");
const local = process.argv.includes("--local");
const state = local
  ? undefined
  : JSON.parse(await readFile(resolve(privateDirectory, "state.json"), "utf8"));
const bundle = resolve(privateDirectory, "bundle");
const remoteDirectory = "/home/opsadmin/remote-console-deploy";
if (!local) {
  const architecture = execFileSync("ssh", [state.sshHost, "uname -m"], {
    encoding: "utf8",
  }).trim();
  if (architecture !== "x86_64")
    throw new Error(`Unsupported target architecture: ${architecture}`);
}
execFileSync("git", ["diff", "--quiet", "HEAD"], { cwd: root, stdio: "inherit" });
const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
execFileSync("pnpm", ["run", "build"], { cwd: root, stdio: "inherit" });
await rm(bundle, { recursive: true, force: true });
await mkdir(bundle, { recursive: true, mode: 0o700 });
await cp(resolve(root, "dist"), resolve(bundle, "dist"), { recursive: true });
if (!local) {
  for (const file of ["application.env", "tunnel-token"])
    await cp(resolve(privateDirectory, file), resolve(bundle, file));
}
await cp(resolve(root, "deploy/install.sh"), resolve(bundle, "install.sh"));
const service = (await readFile(resolve(root, "deploy/remote-console.service"), "utf8")).replace(
  "/usr/bin/node",
  "/opt/remote-console/runtime/bin/node",
);
await writeFile(resolve(bundle, "remote-console.service"), service);
await writeFile(resolve(bundle, "source-revision"), `${revision}\n`);
if (local) {
  console.log(
    `Staged application revision ${revision}; production configuration and runtimes are not copied.`,
  );
  process.exit(0);
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed: ${url} (${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(destination, bytes);
  return bytes;
}

const nodeVersion = "26.10.0";
const nodeFilename = `node-v${nodeVersion}-linux-x64.tar.xz`;
const nodeBase = `https://nodejs.org/dist/v${nodeVersion}`;
const checksumResponse = await fetch(`${nodeBase}/SHASUMS256.txt`);
if (!checksumResponse.ok) throw new Error("Could not fetch official Node checksums");
const nodeChecksums = await checksumResponse.text();
const expectedNodeHash = nodeChecksums
  .split("\n")
  .find((line) => line.endsWith(`  ${nodeFilename}`))
  ?.split(/\s+/)[0];
if (!expectedNodeHash) throw new Error("Node archive was not listed in official checksums");
const nodeBytes = await download(`${nodeBase}/${nodeFilename}`, resolve(bundle, "node.tar.xz"));
if (createHash("sha256").update(nodeBytes).digest("hex") !== expectedNodeHash)
  throw new Error("Node archive checksum mismatch");
const cloudflaredVersion = "2026.9.3";
const releaseResponse = await fetch(
  `https://api.github.com/repos/cloudflare/cloudflared/releases/tags/${cloudflaredVersion}`,
);
if (!releaseResponse.ok) throw new Error("Could not fetch official cloudflared release metadata");
const release = await releaseResponse.json();
const asset = release.assets.find((entry) => entry.name === "cloudflared-linux-amd64");
if (!asset?.digest?.startsWith("sha256:"))
  throw new Error("Official cloudflared release has no SHA256 digest");
const cloudflaredBytes = await download(asset.browser_download_url, resolve(bundle, "cloudflared"));
if (`sha256:${createHash("sha256").update(cloudflaredBytes).digest("hex")}` !== asset.digest)
  throw new Error("cloudflared checksum mismatch");
await writeFile(
  resolve(bundle, "runtime-versions.json"),
  JSON.stringify({ node: nodeVersion, cloudflared: cloudflaredVersion }, null, 2) + "\n",
);
execFileSync("ssh", [state.sshHost, `install -d -m 700 ${remoteDirectory}`], { stdio: "inherit" });
execFileSync(
  "rsync",
  ["-a", "--delete", "--chmod=D700,F600", `${bundle}/`, `${state.sshHost}:${remoteDirectory}/`],
  { stdio: "inherit" },
);
console.log(
  "Prepared and uploaded checksummed runtimes and the standalone application; no node_modules or API token transferred.",
);
console.log(
  `Run in your terminal: ssh -t ${state.sshHost} 'sudo sh ${remoteDirectory}/install.sh'`,
);
