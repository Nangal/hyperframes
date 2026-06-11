/**
 * Local state for the `sfx` commands.
 *
 * The public catalog API is search-only (no fetch-by-id), and presigned
 * `audio_url`s expire (~15 min). So `sfx search` caches each result's
 * download URL + the query that produced it, and `sfx add <id>` reads that
 * cache — refreshing a stale URL by re-running the cached query. The cache
 * is co-located with the downloaded clips under `<assets>/sfx/`.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadProjectConfig } from "../../utils/projectConfig.js";

export interface CachedSfx {
  id: string;
  name: string;
  description: string;
  duration: number | null;
  score: number;
  audio_url: string;
  /** The search query that surfaced this clip — used to refresh an expired URL. */
  query: string;
  /** Epoch ms when audio_url was fetched (presigned URLs expire). */
  fetchedAt: number;
}

const CACHE_FILE = ".catalog-cache.json";

/** Directory SFX clips download into: `<project>/<assets>/sfx`. */
export function sfxDir(projectDir: string): string {
  const config = loadProjectConfig(projectDir);
  return join(resolve(projectDir), config.paths.assets, "sfx");
}

function cachePath(projectDir: string): string {
  return join(sfxDir(projectDir), CACHE_FILE);
}

/** Merge `items` into the per-project search cache (keyed by id). */
export function writeSearchCache(projectDir: string, items: CachedSfx[]): void {
  const dir = sfxDir(projectDir);
  mkdirSync(dir, { recursive: true });
  let all: Record<string, CachedSfx> = {};
  try {
    all = JSON.parse(readFileSync(cachePath(projectDir), "utf-8")) as Record<string, CachedSfx>;
  } catch {
    /* no cache yet */
  }
  for (const it of items) all[it.id] = it;
  writeFileSync(cachePath(projectDir), JSON.stringify(all, null, 2) + "\n", "utf-8");
}

/** Look up a cached clip by id, or undefined if not in the cache. */
export function readCachedSfx(projectDir: string, id: string): CachedSfx | undefined {
  try {
    const all = JSON.parse(readFileSync(cachePath(projectDir), "utf-8")) as Record<
      string,
      CachedSfx
    >;
    return all[id];
  } catch {
    return undefined;
  }
}
