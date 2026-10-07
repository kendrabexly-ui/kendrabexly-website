import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { unzipSync } from "fflate";

const version = process.env.PHOTOCRAFT_VERSION || "0.3.0";
const archiveUrl = `https://github.com/storytold/photocraft/releases/download/v${version}/photocraft-web-${version}.zip`;
const destination = join(process.cwd(), "public", "portal", "photocraft-app");
const expectedPrefix = `photocraft-web-${version}/`;

console.log(`Installing self-hosted PhotoCraft Web v${version}…`);

const response = await fetch(archiveUrl, {
  headers: { "User-Agent": "KendraBexly-Portal-Build" }
});
if (!response.ok) {
  throw new Error(`PhotoCraft download failed: ${response.status} ${response.statusText}`);
}

const zipBytes = new Uint8Array(await response.arrayBuffer());
const files = unzipSync(zipBytes);

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

let wrote = 0;
let foundIndex = false;
let foundWasm = false;

for (const [archivePath, bytes] of Object.entries(files)) {
  if (!archivePath.startsWith(expectedPrefix)) continue;
  const relative = archivePath.slice(expectedPrefix.length);
  if (!relative || relative.endsWith("/")) continue;

  const outputPath = join(destination, relative);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, bytes);
  wrote += 1;

  if (relative === "index.html") foundIndex = true;
  if (relative.endsWith(".wasm")) {
    foundWasm = true;
    const maxCloudflareAssetBytes = 25 * 1024 * 1024;
    if (bytes.length >= maxCloudflareAssetBytes) {
      throw new Error(
        `PhotoCraft WASM is ${bytes.length} bytes and exceeds Cloudflare's 25 MiB per-file asset limit.`
      );
    }
  }
}

if (!foundIndex || !foundWasm) {
  throw new Error("PhotoCraft web package did not contain the expected index.html and .wasm files.");
}

console.log(`PhotoCraft v${version} installed into public/portal/photocraft-app (${wrote} files).`);
