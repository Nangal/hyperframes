#!/usr/bin/env node
// media-use · audio/sfx.mjs — resolve the SFX a host project needs into its slot (assets/sfx/)
// and register them in the one .media/ ledger (defer-to-host: record path == the host slot the
// composition references). Source PRIORITY: the heygen audio catalog (preferred) → the static
// SFX library (fallback). The cue TIMING stays in the host (prep-sfx.mjs); this owns the
// per-sound source choice + freeze + ledger, and returns each clip's REAL duration so the host
// can fill group_spec.sfx[].
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureWorkspace, upsert, parseArgs } from "../_ledger.mjs";
import { heygenAvailable, searchCatalog, pickTrack, downloadTo, writeReport } from "./catalog.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const a = parseArgs(process.argv.slice(2));
const log = (...m) => console.error(...m);
const emit = (o) => {
  console.log(JSON.stringify(o));
  process.exit(o.ok === false ? 1 : 0);
};
const slug = (s) => String(s).toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

const project = a.project && a.project !== true ? a.project : process.cwd();
const sfxLib = a["sfx-lib"] && a["sfx-lib"] !== true ? a["sfx-lib"] : join(here, "..", "..", "assets", "sfx");
const register = !!a.register;
const noHeygen = !!a["no-heygen"];
const maxDuration = a["max-duration"] && a["max-duration"] !== true ? Number(a["max-duration"]) : 15;

// SFX library manifest (durations + descriptions + the fallback files).
let manifest = {};
const manifestPath = join(sfxLib, "manifest.json");
if (existsSync(manifestPath)) {
  try { manifest = JSON.parse(readFileSync(manifestPath, "utf8")); }
  catch (e) { emit({ ok: false, error: `sfx-lib manifest parse: ${e.message}` }); }
}
const byFile = new Map();
for (const [key, e] of Object.entries(manifest)) if (e?.file) byFile.set(e.file, { key, duration: e.duration, description: e.description || "" });

// Cues: the host's sfx[] (each at least { file }, optionally { note } as a better query seed).
let cues = [];
if (a.cues && a.cues !== true && existsSync(a.cues)) {
  try { const j = JSON.parse(readFileSync(a.cues, "utf8")); cues = Array.isArray(j) ? j : Array.isArray(j.sfx) ? j.sfx : []; }
  catch (e) { emit({ ok: false, error: `--cues parse: ${e.message}` }); }
}
const wantFiles = [...new Map(cues.filter((c) => c.file).map((c) => [c.file, c])).values()]; // unique by file

const destDir = join(project, "assets", "sfx");
mkdirSync(destDir, { recursive: true });
if (register) ensureWorkspace(project);

const useHeygen = !noHeygen && heygenAvailable();
const resolved = [];
const registered = [];
let copied = 0;

for (const cue of wantFiles) {
  const file = cue.file;
  const dest = join(destDir, file);
  const lib = byFile.get(file);
  let duration = lib?.duration;
  let provider = null;
  let description = lib?.description || file;

  // 1) PREFERRED: heygen catalog (search by the cue note, else the filename stem).
  if (useHeygen) {
    const query = (cue.note && String(cue.note).trim()) || `${slug(file).replace(/_/g, " ")} sound effect`;
    try {
      const tracks = searchCatalog(query, { limit: 12 });
      const pick = pickTrack(tracks, { maxDuration });
      if (pick && pick.audio_url) {
        await downloadTo(pick.audio_url, dest);
        duration = pick.duration != null ? pick.duration : duration;
        provider = "heygen.audio.sounds";
        description = pick.description || pick.name || query;
        if (register) writeReport(project, `sfx_${slug(file)}`, "resolve:sfx", query, pick.id, tracks);
        copied++;
        log(`sfx ${file}: heygen "${pick.name}" ${duration}s`);
      } else log(`sfx ${file}: heygen no short clip for "${query}" → library`);
    } catch (e) {
      log(`sfx ${file}: heygen failed (${(e.message || e).toString().slice(0, 80)}) → library`);
    }
  }

  // 2) FALLBACK: static library file.
  if (!provider) {
    if (lib && existsSync(join(sfxLib, file))) {
      if (!existsSync(dest)) { copyFileSync(join(sfxLib, file), dest); copied++; }
      provider = "static-sfx-library";
    } else {
      log(`sfx ${file}: not in catalog and not in library → skipped`);
      continue;
    }
  }

  resolved.push({ file, duration, provider });
  if (register) {
    const id = `sfx_${slug(file)}`;
    const fromHeygen = provider === "heygen.audio.sounds";
    upsert(project, {
      asset_id: id,
      type: "sfx",
      path: `assets/sfx/${file}`,
      source: fromHeygen ? "search" : "generated",
      status: "ready",
      description: String(description).slice(0, 200),
      tags: ["sfx", "audio"],
      provenance: fromHeygen ? { provider: "heygen.audio.sounds" } : { provider: "static-sfx-library", derived_from: "media-use/assets/sfx" },
      metadata: { duration },
      reusable: !fromHeygen,
      used_in: [basename(project.replace(/\/+$/, ""))],
    });
    registered.push(id);
  }
}

emit({ ok: true, source: useHeygen ? "heygen-preferred" : "library", copied, resolved, registered });
