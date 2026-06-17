#!/usr/bin/env node
// Oracle (the SPEC) for the media-use audio-PRODUCE layer — the BGM + SFX that the video
// workflows DEFER to media-use for (vs. resolve.mjs, which picks from the heygen catalog).
// Eval-first: run this BEFORE building scripts/audio/* to prove it FAILS, then build
// infer-bgm-prompt.mjs / sfx.mjs / bgm.mjs until it PASSES; re-run on every change.
//
// Mostly OFFLINE + FAST: case 1 is pure; case 2 uses the local SFX library; cases 3/4 use
// `bgm.mjs --dry-run`, which exercises backend-selection + the audio_meta fields + the ledger
// WITHOUT launching a (slow, model-downloading) MusicGen/Lyria process. The REAL generation is
// proven by the per-skill end-to-end run, not here.
//
// Usage: node scripts/oracle-audio-produce.mjs
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { heygenAvailable } from "./audio/catalog.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const audio = join(here, "audio");
const inferMod = join(audio, "infer-bgm-prompt.mjs");
const sfxCli = join(audio, "sfx.mjs");
const bgmCli = join(audio, "bgm.mjs");
const sfxLib = join(here, "..", "assets", "sfx");

const readManifest = (ws) =>
  existsSync(join(ws, ".media", "manifest.jsonl"))
    ? readFileSync(join(ws, ".media", "manifest.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
    : [];
const lastJson = (s) => JSON.parse(s.trim());
const results = [];
const rec = (name, problems) => results.push({ name, problems });

// ---- Case 1: infer-bgm-prompt (pure, offline) ----
{
  const p = [];
  try {
    const { inferBgmPrompt } = await import(pathToFileURL(inferMod).href);
    const crypto = inferBgmPrompt({ scenes: [{ script: "our web3 token wallet on the blockchain" }] });
    if (!/atmospheric electronic|deep bass/.test(crypto)) p.push(`crypto base wrong: ${crypto}`);
    const fin = inferBgmPrompt({ scenes: [{ script: "a fintech bank payment platform" }] });
    if (!/calm cinematic/.test(fin)) p.push(`fintech base wrong: ${fin}`);
    const dflt = inferBgmPrompt({ scenes: [{ script: "a productivity dashboard" }] });
    if (!/uplifting corporate tech/.test(dflt)) p.push(`default base wrong: ${dflt}`);
    const pas = inferBgmPrompt({ narrativeArchetype: "PAS", scenes: [{ script: "a saas tool" }] });
    if (!/MINOR to MAJOR/.test(pas)) p.push(`PAS arc missing MINOR to MAJOR: ${pas}`);
    const override = inferBgmPrompt({ scenes: [{ script: "x" }] }, { userBgmPrompt: "MY PROMPT" });
    if (override !== "MY PROMPT") p.push(`--bgm-prompt override not honored: ${override}`);
  } catch (e) {
    p.push(`import/run failed: ${(e.message || e).toString().slice(0, 160)}`);
  }
  rec("infer-bgm-prompt (pure, offline)", p);
}

// ---- Case 2: sfx.mjs freeze + register + idempotent (offline, local library) ----
{
  const p = [];
  const ws = mkdtempSync(join(tmpdir(), "mu-audio-sfx-"));
  const cues = join(ws, "cues.json");
  // whoosh appears twice → must register once (dedup by file).
  writeFileSync(cues, JSON.stringify({ sfx: [{ file: "whoosh.mp3", t: 0.2 }, { file: "chime.mp3", t: 1.0 }, { file: "whoosh.mp3", t: 2.0 }] }));
  // --no-heygen forces the static-library path so this case is deterministic offline (the live
  // heygen-preferred SFX path is exercised by the per-skill e2e).
  const run = () => lastJson(execFileSync("node", [sfxCli, "--project", ws, "--cues", cues, "--sfx-lib", sfxLib, "--register", "--no-heygen"], { encoding: "utf8" }));
  try {
    const out = run();
    if (!out.ok) p.push(`not ok: ${out.error}`);
    for (const f of ["whoosh.mp3", "chime.mp3"]) if (!existsSync(join(ws, "assets", "sfx", f))) p.push(`not frozen into host slot: assets/sfx/${f}`);
    const sfxRecs = readManifest(ws).filter((r) => r.type === "sfx");
    if (sfxRecs.length !== 2) p.push(`want 2 sfx records (whoosh dedup'd), got ${sfxRecs.length}`);
    for (const r of sfxRecs) {
      if (!r.path.startsWith("assets/sfx/")) p.push(`record path not the host slot: ${r.path}`);
      if (!(r.metadata && r.metadata.duration > 0)) p.push(`record ${r.asset_id} missing metadata.duration`);
      if (r.provenance?.provider !== "static-sfx-library") p.push(`--no-heygen record ${r.asset_id} provider=${r.provenance?.provider} (want static-sfx-library)`);
    }
    run(); // idempotent re-run
    if (readManifest(ws).filter((r) => r.type === "sfx").length !== 2) p.push("not idempotent — re-run changed the sfx record count");
  } catch (e) {
    p.push(`run failed: ${(e.stdout || e.message || e).toString().slice(0, 200)}`);
  }
  rec("sfx.mjs freeze + register + idempotent", p);
}

// ---- Case 3: bgm.mjs --dry-run (backend selection + meta + register pending) ----
{
  const p = [];
  const ws = mkdtempSync(join(tmpdir(), "mu-audio-bgm-"));
  const ns = join(ws, "narrator_scripts.json");
  writeFileSync(ns, JSON.stringify({ narrativeArchetype: "BAB", scenes: [{ script: "a fintech payments launch" }] }));
  try {
    const out = lastJson(execFileSync("node", [bgmCli, "--project", ws, "--narrator-scripts", ns, "--target-seconds", "3", "--register", "--dry-run"], { encoding: "utf8" }));
    if (out.ok !== true) p.push(`not ok: ${out.error}`);
    if (out.bgm_enabled) {
      if (out.bgm_path !== "assets/bgm.wav") p.push(`bgm_path=${out.bgm_path} (want assets/bgm.wav)`);
      if (!["heygen.audio.sounds", "lyria", "musicgen"].includes(out.bgm_provider)) p.push(`provider=${out.bgm_provider}`);
      if (out.bgm_target_duration_s !== 3) p.push(`target=${out.bgm_target_duration_s} (want 3)`);
      const bgm = readManifest(ws).find((r) => r.type === "bgm");
      if (!bgm) p.push("no bgm record registered");
      else {
        if (bgm.status !== "pending") p.push(`bgm record status=${bgm.status} (want pending pre-render)`);
        if (bgm.path !== "assets/bgm.wav") p.push(`bgm record path=${bgm.path} (want host slot)`);
        if (!bgm.provenance || !bgm.provenance.prompt) p.push("bgm record missing provenance.prompt");
      }
    } else {
      // No backend available (a bare box: no heygen auth, no Lyria key, no MusicGen deps) →
      // bgm_path must be null + a reason given. This is the correct degrade, not a failure.
      if (out.bgm_path !== null) p.push(`disabled but bgm_path=${out.bgm_path} (want null)`);
      if (!out.bgm_reason) p.push("bgm_enabled false but no bgm_reason (must explain the degrade)");
    }
  } catch (e) {
    p.push(`run failed: ${(e.stdout || e.message || e).toString().slice(0, 200)}`);
  }
  rec("bgm.mjs --dry-run (select + meta + register pending)", p);
}

// ---- Case 4: bgm.mjs --no-bgm degrade (must never block) ----
{
  const p = [];
  const ws = mkdtempSync(join(tmpdir(), "mu-audio-nobgm-"));
  try {
    const out = lastJson(execFileSync("node", [bgmCli, "--project", ws, "--target-seconds", "5", "--no-bgm", "--dry-run"], { encoding: "utf8" }));
    if (out.ok !== true) p.push(`not ok: ${out.error}`);
    if (out.bgm_enabled !== false) p.push("bgm_enabled should be false with --no-bgm");
    if (!/no-bgm/.test(out.bgm_reason || "")) p.push(`bgm_reason=${out.bgm_reason}`);
  } catch (e) {
    p.push(`run failed: ${(e.stdout || e.message || e).toString().slice(0, 200)}`);
  }
  rec("bgm.mjs --no-bgm degrade", p);
}

// ---- Case 5: heygen is PREFERRED (live, gated on heygen auth) ----
{
  const p = [];
  if (!heygenAvailable()) {
    console.log("SKIP  heygen-preferred bgm (heygen not authed) — the live heygen path is covered by the per-skill e2e when authed");
  } else {
    const ws = mkdtempSync(join(tmpdir(), "mu-audio-hey-"));
    const args = ["--project", ws, "--target-seconds", "8", "--bgm-prompt", "subtle confident tech launch"];
    try {
      // priority: with heygen authed, the plan MUST pick heygen over lyria/musicgen
      const plan = lastJson(execFileSync("node", [bgmCli, ...args, "--dry-run"], { encoding: "utf8" }));
      if (plan.bgm_provider !== "heygen.audio.sounds") p.push(`heygen authed but plan chose ${plan.bgm_provider} — must PREFER heygen`);
      // live: a real run freezes a catalog track into the host slot, ready now (not pending)
      const out = lastJson(execFileSync("node", [bgmCli, ...args, "--register"], { encoding: "utf8" }));
      if (!out.bgm_enabled) p.push(`live heygen run not enabled: ${out.bgm_reason}`);
      if (out.bgm_provider !== "heygen.audio.sounds") p.push(`live provider=${out.bgm_provider}`);
      if (out.bgm_pending) p.push("heygen bgm should be READY, not pending (synchronous)");
      if (!existsSync(join(ws, "assets", "bgm.wav"))) p.push("assets/bgm.wav not frozen into host slot");
      const bgm = readManifest(ws).find((r) => r.type === "bgm");
      if (!bgm) p.push("no bgm record registered");
      else {
        if (bgm.status !== "ready") p.push(`bgm record status=${bgm.status} (want ready)`);
        if (bgm.path !== "assets/bgm.wav") p.push(`bgm record path=${bgm.path} (want host slot)`);
        if (bgm.provenance?.provider !== "heygen.audio.sounds") p.push(`bgm provider=${bgm.provenance?.provider}`);
      }
    } catch (e) {
      p.push(`live run failed: ${(e.stdout || e.message || e).toString().slice(0, 200)}`);
    }
    rec("heygen PREFERRED bgm (live)", p);
  }
}

let allPass = true;
for (const r of results) {
  const pass = r.problems.length === 0;
  allPass = allPass && pass;
  console.log(`${pass ? "PASS" : "FAIL"}  ${r.name}`);
  r.problems.forEach((x) => console.log(`        - ${x}`));
}
console.log(allPass ? "\nAUDIO-PRODUCE ORACLE: PASS" : "\nAUDIO-PRODUCE ORACLE: FAIL");
process.exit(allPass ? 0 : 1);
