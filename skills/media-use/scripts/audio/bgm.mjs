#!/usr/bin/env node
// media-use · audio/bgm.mjs — the BGM brain the video workflows defer to. BGM ONLY
// (voice/TTS stays in the host audio.mjs for this MVP). Source PRIORITY:
//   1) heygen audio catalog (PREFERRED, synchronous) — a licensed track frozen to assets/bgm.wav
//   2) Lyria (cloud generate, detached) — needs GEMINI_API_KEY / GOOGLE_API_KEY
//   3) MusicGen (local generate, detached) — free, no key
// Freezes into the host slot <project>/assets/bgm.wav and (with --register) records it in the one
// .media/ ledger (path == the host slot, defer-to-host). Prints the BGM half of audio_meta.json as
// the LAST stdout line (logs → stderr) so the caller can splice it in. The Lyria/MusicGen paths are
// spawned DETACHED (return bgm_pending:true + a pid for wait-bgm.mjs); the heygen path is ready now.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, closeSync, readFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureWorkspace, upsert, parseArgs } from "../_ledger.mjs";
import { inferBgmPrompt } from "./infer-bgm-prompt.mjs";
import { heygenAvailable, searchCatalog, pickTrack, downloadTo, writeReport } from "./catalog.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const log = (...m) => console.error(...m); // stderr — keep stdout clean for the JSON contract
const a = parseArgs(process.argv.slice(2));
const emit = (o) => { console.log(JSON.stringify(o)); process.exit(0); };

const project = a.project && a.project !== true ? a.project : process.cwd();
const dryRun = !!a["dry-run"];
const noBgm = !!a["no-bgm"];
const noHeygen = !!a["no-heygen"];
const register = !!a.register;
const recipe = a["lyria-recipe"] && a["lyria-recipe"] !== true ? a["lyria-recipe"] : join(here, "lyria-recipe.py");
const seedSeconds = Math.min(Number(a["bgm-seed-seconds"]) || 28, 30);

const nsPath = a["narrator-scripts"] && a["narrator-scripts"] !== true ? a["narrator-scripts"] : join(project, "narrator_scripts.json");
let narrator = {};
if (existsSync(nsPath)) { try { narrator = JSON.parse(readFileSync(nsPath, "utf8")); } catch {} }
const sumScenes = () => (narrator.scenes || []).reduce((t, x) => t + (parseFloat(String(x.estimatedDuration ?? "0").match(/[\d.]+/)?.[0]) || 0), 0);
const targetS = Math.max(1, Number(a["target-seconds"]) || sumScenes() || 30);

loadEnv(project);
const lyriaKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
const BGM_PY_DEPS = ["transformers", "torch", "soundfile", "numpy"];
const BGM_PY_PROBE = "import transformers, soundfile, torch, numpy; from transformers import MusicgenForConditionalGeneration";
const LYRIA_PY_PROBE = "import google.genai";
const pyOk = (code) => spawnSync("python3", ["-c", code], { stdio: "ignore" }).status === 0;

const bgmRel = "assets/bgm.wav";
const bgmAbs = join(project, bgmRel);
const prompt = inferBgmPrompt(narrator, { userBgmPrompt: a["bgm-prompt"] && a["bgm-prompt"] !== true ? a["bgm-prompt"] : undefined });
const heygenUsable = !noBgm && !noHeygen && heygenAvailable();
const lyriaConfigured = !noBgm && !!lyriaKey() && existsSync(recipe);

function registerBgm(provider, status, extra = {}) {
  if (!register) return;
  ensureWorkspace(project);
  const fromHeygen = provider === "heygen.audio.sounds";
  upsert(project, {
    asset_id: "bgm_001", type: "bgm", path: bgmRel, source: fromHeygen ? "search" : "generated", status,
    description: prompt.slice(0, 120), tags: ["bgm", "audio"],
    provenance: { provider, prompt, ...(fromHeygen ? {} : { model: provider === "lyria" ? "lyria-realtime" : "facebook/musicgen-small" }) },
    metadata: { duration: Number(targetS.toFixed(3)), ...extra },
  });
}
const META = (o) => ({ ok: true, bgm_path: o.enabled ? bgmRel : null, bgm_enabled: !!o.enabled, bgm_provider: o.provider || null,
  bgm_pending: !!o.pending, bgm_log: o.log || null, bgm_pid: o.pid || null, bgm_mode: o.mode || null,
  bgm_target_duration_s: o.enabled ? Number(targetS.toFixed(3)) : null, bgm_seed_duration_s: o.seed || null,
  bgm_loop_count: o.loops || null, bgm_reason: o.reason || null, ...(o.extra || {}) });

// ---- noBgm ----
if (noBgm) emit(META({ enabled: false, reason: "disabled by --no-bgm" }));

// ---- dry-run: report the would-be source by PRIORITY, no I/O, no installs ----
if (dryRun) {
  const provider = heygenUsable ? "heygen.audio.sounds" : lyriaConfigured ? "lyria" : pyOk(BGM_PY_PROBE) ? "musicgen" : null;
  if (register && provider) registerBgm(provider, "pending");
  emit(META({ enabled: !!provider, provider, pending: provider !== "heygen.audio.sounds" && !!provider,
    reason: provider ? null: "no source: heygen not authed, no Lyria key/recipe, MusicGen deps unavailable", extra: { dry_run: true, prompt } }));
}

// ---- 1) PREFERRED: heygen catalog (synchronous, ready now) ----
if (heygenUsable) {
  try {
    const tracks = searchCatalog(prompt, { limit: 8 });
    const pick = pickTrack(tracks); // BGM: top-1 (length handled by the composition's loop/duck)
    if (pick && pick.audio_url) {
      await downloadTo(pick.audio_url, bgmAbs);
      if (register) { writeReport(project, "bgm_001", "resolve:bgm", prompt, pick.id, tracks); registerBgm("heygen.audio.sounds", "ready", { catalog_duration: pick.duration }); }
      emit(META({ enabled: true, provider: "heygen.audio.sounds", pending: false, mode: "catalog", extra: { track: pick.name } }));
    }
    log(`bgm: heygen returned no usable track → fallback`);
  } catch (e) {
    log(`bgm: heygen failed (${(e.message || e).toString().slice(0, 120)}) → fallback`);
  }
}

// ---- 2) Lyria (detached) ----
if (lyriaConfigured && makeAvailable(LYRIA_PY_PROBE, ["google-genai", "python-dotenv"])) {
  const { pid, log: logPath } = spawnDetached("python3", [recipe, "--output", bgmAbs, "--duration", String(Math.max(1, targetS)), "--prompt", prompt]);
  registerBgm("lyria", "pending");
  emit(META({ enabled: true, provider: "lyria", pending: true, log: logPath, pid, mode: "detached-single" }));
}

// ---- 3) MusicGen (detached) ----
if (makeAvailable(BGM_PY_PROBE, BGM_PY_DEPS)) {
  const seedS = Math.min(seedSeconds, 30);
  const loops = targetS > seedS ? Math.ceil(targetS / seedS) : 1;
  const mode = targetS > seedS ? "detached-seed-loop" : "detached-seed-trim";
  const { pid, log: logPath } = spawnDetached("python3", ["-c", musicgenScript(prompt, bgmAbs, targetS, seedS)]);
  registerBgm("musicgen", "pending", { seed_duration_s: seedS, loop_count: loops });
  emit(META({ enabled: true, provider: "musicgen", pending: true, log: logPath, pid, mode, seed: seedS, loops }));
}

// ---- none ----
emit(META({ enabled: false, reason: `no source available (heygen not authed; no Lyria key/recipe; MusicGen deps could not be installed — pip install ${BGM_PY_DEPS.join(" ")})` }));

// ---------- helpers ----------
function makeAvailable(probe, deps) {
  if (pyOk(probe)) return true;
  log(`bgm: installing python deps (${deps.join(" ")})…`);
  const r = spawnSync("pip", ["install", "-q", ...deps], { stdio: "ignore" });
  return r.status === 0 && pyOk(probe);
}
function spawnDetached(cmd, args) {
  mkdirSync(dirname(bgmAbs), { recursive: true });
  const reports = join(project, ".media", "reports");
  mkdirSync(reports, { recursive: true });
  const logPath = join(reports, `bgm-${Date.now()}.log`);
  const fd = openSync(logPath, "w");
  const child = spawn(cmd, args, { detached: true, stdio: ["ignore", fd, fd] });
  child.unref();
  closeSync(fd);
  return { pid: child.pid, log: logPath };
}
function loadEnv(dir) {
  const f = join(dir, ".env");
  if (!existsSync(f)) return;
  try {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
function musicgenScript(prompt, outPath, targetSec, seedSec) {
  return `
import math
import os
import sys
import traceback
from pathlib import Path

import numpy as np
import soundfile as sf
from transformers import MusicgenForConditionalGeneration, AutoProcessor

prompt = ${JSON.stringify(prompt)}
out_path = ${JSON.stringify(outPath)}
target_s = float(${targetSec.toFixed(3)})
seed_s = float(${seedSec.toFixed(3)})
token_rate = 50
crossfade_s = 0.3

def apply_fade(arr, sr, fade_in_s=0.08, fade_out_s=0.5):
    n_in = min(int(round(fade_in_s * sr)), arr.shape[0] // 2)
    n_out = min(int(round(fade_out_s * sr)), arr.shape[0] // 2)
    if n_in > 1:
        arr[:n_in] *= np.linspace(0.0, 1.0, n_in, dtype="float32")
    if n_out > 1:
        arr[-n_out:] *= np.linspace(1.0, 0.0, n_out, dtype="float32")
    return arr

def loop_crossfade(seed, target_len, xf):
    if seed.shape[0] >= target_len:
        return seed[:target_len]
    xf = min(xf, seed.shape[0] // 2)
    if xf < 1:
        reps = int(math.ceil(target_len / seed.shape[0]))
        return np.tile(seed, reps)[:target_len]
    t = np.linspace(0.0, 1.0, xf, dtype="float32")
    fade_out = np.cos(t * (math.pi / 2))
    fade_in = np.sin(t * (math.pi / 2))
    out = seed.copy()
    while out.shape[0] < target_len:
        tail = out[-xf:] * fade_out
        head = seed[:xf] * fade_in
        out = np.concatenate([out[:-xf], tail + head, seed[xf:]])
    return out[:target_len]

try:
    Path(os.path.dirname(out_path)).mkdir(parents=True, exist_ok=True)
    print(f"[musicgen] seed render target={target_s:.3f}s seed={seed_s:.3f}s", flush=True)
    processor = AutoProcessor.from_pretrained("facebook/musicgen-small")
    model = MusicgenForConditionalGeneration.from_pretrained("facebook/musicgen-small")
    model.eval()
    sr = int(model.config.audio_encoder.sampling_rate)

    gen_s = min(seed_s, target_s)
    tokens = max(1, int(math.ceil(gen_s * token_rate)))
    print(f"[musicgen] generating seed: dur={gen_s:.3f}s tokens={tokens}", flush=True)
    inputs = processor(text=[prompt], padding=True, return_tensors="pt")
    audio = model.generate(**inputs, max_new_tokens=tokens)
    seed = audio[0, 0].detach().cpu().numpy().astype("float32")

    seed_peak = float(np.max(np.abs(seed)))
    if seed_peak > 1e-6:
        seed = seed * (0.89 / seed_peak)

    want_total = max(1, int(round(target_s * sr)))
    if seed.shape[0] >= want_total:
        final = seed[:want_total].copy()
        print(f"[musicgen] trimmed seed to {want_total} samples", flush=True)
    else:
        xf = int(round(crossfade_s * sr))
        final = loop_crossfade(seed, want_total, xf)
        print(f"[musicgen] crossfade-looped seed to {final.shape[0]} samples", flush=True)

    if final.shape[0] < want_total:
        final = np.pad(final, (0, want_total - final.shape[0]))
    else:
        final = final[:want_total]
    final = apply_fade(final, sr)
    peak = float(np.max(np.abs(final)))
    if peak > 1.0:
        final = final / peak
    sf.write(out_path, final, sr)
    print(f"[musicgen] wrote {out_path} samples={final.shape[0]} sr={sr}", flush=True)
except Exception:
    traceback.print_exc()
    sys.exit(1)
`;
}
