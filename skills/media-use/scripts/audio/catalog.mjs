// media-use · audio/catalog.mjs — the heygen audio catalog (BGM + SFX), the PREFERRED source.
// Extracted from resolve.mjs so bgm.mjs / sfx.mjs reuse the exact same search + freeze the
// composition already trusts (resolve.mjs --type bgm|sfx remains the standalone catalog picker;
// this is the shared engine behind both). SFX and BGM share one catalog: the `sound_effect`
// type is reserved, so SFX clips surface via SFX-worded queries + a short-duration bias.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

// fs/env only — never hardcode model state (matches _ledger.probeProviders).
export function heygenAvailable() {
  const onPath = (process.env.PATH || "").split(":").some((d) => d && existsSync(join(d, "heygen")));
  const authed = existsSync(join(homedir(), ".heygen/credentials")) || !!process.env.HEYGEN_API_KEY;
  return onPath && authed;
}

// `heygen audio sounds list` → normalized tracks (id, name, description, duration, score, audio_url).
export function searchCatalog(query, { limit = 8 } = {}) {
  const r = spawnSync("heygen", ["audio", "sounds", "list", "--query", query, "--limit", String(limit)], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`heygen audio sounds list failed: ${(r.stderr || r.stdout || "").toString().slice(0, 200)}`);
  const res = JSON.parse(r.stdout);
  return (res.data || []).map((t, i) => ({
    index: i,
    id: t.id,
    name: t.name,
    description: t.description,
    duration: t.duration,
    score: t.score,
    audio_url: t.audio_url,
  }));
}

// Pick the top track; for SFX, bias to short clips (the catalog is music-first, so a "whoosh"
// query can rank a 70s track #1) — mirrors resolve.mjs --type sfx.
export function pickTrack(tracks, { maxDuration } = {}) {
  if (!tracks.length) return null;
  if (maxDuration != null) {
    const short = tracks.find((t) => t.duration != null && t.duration <= maxDuration);
    if (short) return short;
  }
  return tracks[0];
}

export async function downloadTo(audioUrl, destPath) {
  const res = await fetch(audioUrl);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  mkdirSync(dirname(destPath), { recursive: true });
  writeFileSync(destPath, Buffer.from(await res.arrayBuffer()));
}

export function extFromUrl(url, fallback = "mp3") {
  return (url.split("?")[0].match(/\.(\w+)$/) || ["", fallback])[1];
}

// Persist the selection trace (intent + candidates + pick) — same shape resolve.mjs writes, so
// select-oracle.mjs can score either path.
export function writeReport(ws, assetId, verb, intent, picked, tracks) {
  const rel = `.media/reports/resolve_${assetId}.json`;
  const abs = join(ws, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(
    abs,
    JSON.stringify(
      { verb, intent, picked, candidates: tracks.map((t) => ({ id: t.id, name: t.name, description: t.description, duration: t.duration, score: t.score })) },
      null,
      2,
    ) + "\n",
  );
  return rel;
}
