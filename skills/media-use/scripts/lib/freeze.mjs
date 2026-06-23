import { writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export async function freezeUrl(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`freeze failed: HTTP ${res.status} for ${String(url).slice(0, 80)}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0)
    throw new Error(`freeze failed: empty response for ${String(url).slice(0, 80)}`);
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, bytes);
  return bytes.length;
}

export function freezeLocalFile(srcPath, destPath) {
  mkdirSync(dirname(destPath), { recursive: true });
  copyFileSync(srcPath, destPath);
}
