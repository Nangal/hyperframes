#!/usr/bin/env node
// Phase 4c (engine) — deterministic index.html assembly. No subagent.
//
// Owns the mechanical, judgment-free half of finalize (the old
// hyperframes-finalize.md "Step 2"): turning group_spec.json + on-disk state
// into the top-level index.html. The finalize AGENT no longer hand-authors
// clip/audio elements, hand-computes start_s, picks track indices, or eyeballs
// data-duration — those are this script's invariants now. Mirrors the
// captions.mjs group precedent (deterministic engine, agent does only judgment).
//
// index.html is a *standalone* (top-level) composition: root <div> lives
// directly in <body> with NO <template> wrapper (template is for sub-comps).
// Structure is modeled verbatim on proven artifacts — the brex-launch-video
// real pipeline output (scene track 0 + voice track 10) and the style-10-prod
// producer golden test (sub-comp host divs carry data-composition-id matching
// the inner file's id; <audio> carries class="clip"). The whole
// product-launch-video pipeline is fixed at 1920x1080 (scene workers hardcode
// and self-check those dims — agents/hyperframes-scene.md), so the root dims
// are constants here too.
//
// Track lanes (must not collide — lint flags overlapping_clips_same_track):
//   0      scene sub-comp clips
//   10     per-scene voice <audio>
//   11     BGM <audio>
//   12     captions sub-comp clip
//   20+i   SFX <audio> (one lane each, in group_spec.sfx[] order)
//
// Reads:  ./group_spec.json (Phase 4a) — total_duration_s, font_face_css,
//           bgm_path, sfx[], groups[].scenes[<sid>].{start_s,
//           estimatedDuration_s, voicePath}. On-disk inside --hyperframes:
//           compositions/<sid>.html (existence + root data-duration cross-check),
//           assets/voice/*.wav, assets/bgm.wav, compositions/captions.html,
//           assets/sfx/*.mp3.
// Writes: ./index.html inside the HyperFrames project root (--hyperframes).
//
// Usage:
//   node assemble-index.mjs --group-spec ./group_spec.json --hyperframes . \
//        [--out ./index.html]
//
// Exit 0 = index.html written + summary on stdout.
// Exit 1 = fatal: group_spec unreadable / no scenes / a scene file missing /
//          a scene's root data-duration disagrees with group_spec beyond
//          DUR_EPSILON (voice/SFX/captions global timing assume group_spec —
//          re-dispatch the worker to honor estimatedDuration_s, or re-run prep).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// ---------- argv ----------
const argv = process.argv.slice(2);
const flag = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : def;
};
function die(msg) {
  console.error(`✗ assemble-index.mjs: ${msg}`);
  process.exit(1);
}

const groupSpecPath = resolve(flag("group-spec", "./group_spec.json"));
const hyperframesDir = resolve(flag("hyperframes", "."));
const outPath = resolve(flag("out", join(hyperframesDir, "index.html")));

// 1/100s. Scene workers are handed estimatedDuration_s (3-decimal) and must
// echo it on the root; anything past this slack desyncs the precomputed start_s
// / voice / SFX / captions timing, so it's fatal (fix upstream, not here).
const DUR_EPSILON = 0.01;

// w2h adaptation: parameterize dimensions via group_spec.composition.{width,height,fps}
// with defaults to 1920x1080@30 (matching plv2's hardcoded values). Workers still
// hardcode + self-check 1920x1080 today, but the assembler must support portrait /
// square for social ads.
const voiceMode = flag("voice-mode", "global"); // "global" | "per-scene"

// (groupSpec is parsed below; declare WIDTH/HEIGHT after we have access to it.)

if (!existsSync(groupSpecPath)) die(`group_spec.json not found at ${groupSpecPath}`);
let groupSpec;
try {
  groupSpec = JSON.parse(readFileSync(groupSpecPath, "utf8"));
} catch (e) {
  die(`group_spec.json parse: ${e.message}`);
}

const totalDuration = Number(groupSpec.total_duration_s);
if (!isFinite(totalDuration) || totalDuration <= 0)
  die(`group_spec.total_duration_s missing or non-positive (${groupSpec.total_duration_s})`);

// w2h adaptation: composition dims from group_spec, default to 1920x1080
// (matches plv2's hardcoded values; w2h prep emits these explicitly in
// group_spec.canvas / group_spec.composition).
const WIDTH = Number(groupSpec.composition?.width ?? groupSpec.canvas?.width ?? 1920);
const HEIGHT = Number(groupSpec.composition?.height ?? groupSpec.canvas?.height ?? 1080);
if (!isFinite(WIDTH) || WIDTH <= 0 || WIDTH % 2 !== 0)
  die(`composition width must be a positive even integer, got ${WIDTH}`);
if (!isFinite(HEIGHT) || HEIGHT <= 0 || HEIGHT % 2 !== 0)
  die(`composition height must be a positive even integer (ffmpeg yuv420p), got ${HEIGHT}`);

// Flatten play order: groups in array order, scene_ids in array order.
const playOrder = [];
for (const g of groupSpec.groups || []) {
  for (const sid of g.scene_ids || []) {
    playOrder.push({ sid, scene: g.scenes?.[sid] || {} });
  }
}
if (playOrder.length === 0) die("no scenes in group_spec.groups[].scene_ids");

// w2h adaptation: HyperShader configuration (optional). When present the
// assembler emits scene host divs with class="scene" + background-color,
// includes hyper-shader-local.js after GSAP, and replaces the vanilla
// timeline bootstrap with HyperShader.init({bgColor, accentColor, scenes,
// transitions}). When absent the assembler emits plv2's vanilla form
// (window.__timelines["main"] = gsap.timeline({paused:true})).
const shaderTransitions = groupSpec.shader_transitions || null;
if (shaderTransitions) {
  const ns = (shaderTransitions.scenes || []).length;
  const nt = (shaderTransitions.transitions || []).length;
  if (ns !== nt + 1) {
    die(
      `shader_transitions invariant violation: scenes.length must equal transitions.length + 1 ` +
        `(got scenes=${ns}, transitions=${nt}). HyperShader.init throws at runtime otherwise.`,
    );
  }
}
const useHyperShader = shaderTransitions != null;

const anomalies = [];

// ---------- helper: pull the root <div>'s data-duration ----------
// The root is the element carrying id="root"; match its full opening tag (same
// shape check-compositions.mjs uses) and read data-duration off THAT tag, not
// some inner clip's. Returns null if the file has no id="root" tag or that tag
// carries no data-duration (check-compositions already gates both — here a null
// just skips the cross-check rather than guessing).
function rootDataDuration(html) {
  const tagM = html.match(/<div\b[^>]*\bid=["']root["'][^>]*>/i);
  if (!tagM) return null;
  const durM = tagM[0].match(/\bdata-duration=["']([\d.]+)["']/);
  return durM ? parseFloat(durM[1]) : null;
}

// ---------- per-scene: existence + duration cross-check ----------
const durMismatches = [];
for (const { sid, scene } of playOrder) {
  const compRel = `compositions/${sid}.html`;
  const compAbs = join(hyperframesDir, compRel);
  if (!existsSync(compAbs)) {
    die(
      `scene file ${compRel} missing — run check-compositions.mjs / re-dispatch worker before assembling`,
    );
  }
  const specDur = Number(scene.estimatedDuration_s);
  if (!isFinite(specDur) || specDur <= 0) {
    die(
      `${sid}: group_spec estimatedDuration_s missing or non-positive (${scene.estimatedDuration_s})`,
    );
  }
  const rootDur = rootDataDuration(readFileSync(compAbs, "utf8"));
  if (rootDur == null) {
    anomalies.push(
      `${sid}: could not read root data-duration from ${compRel} — skipped duration cross-check`,
    );
  } else if (Math.abs(rootDur - specDur) > DUR_EPSILON) {
    durMismatches.push(`${sid}: worker root data-duration=${rootDur}s but group_spec=${specDur}s`);
  }
}
if (durMismatches.length > 0) {
  die(
    `scene root data-duration disagrees with group_spec (voice / SFX / captions timing assume group_spec):\n  ${durMismatches.join("\n  ")}\n  → re-dispatch the worker to honor estimatedDuration_s, or re-run prep.mjs.`,
  );
}

// ---------- voice configuration ----------
// w2h adaptation: support BOTH plv2's per-scene voicePath model AND w2h's
// real-world global-narration model. group_spec.voice = { path, start_s,
// duration_s, volume?, track_index? } at top level drives global mode.
const globalVoice = groupSpec.voice;
const globalVoicePath =
  globalVoice && typeof globalVoice.path === "string" ? globalVoice.path : null;
const hasGlobalVoice =
  voiceMode === "global" &&
  globalVoicePath != null &&
  existsSync(join(hyperframesDir, globalVoicePath));

// ---------- BGM volume: duck under narration if any voice is present ----------
// Values track references/background-music.md: under-VO sits at 0.4–0.6 (the
// example storyboard line uses ~0.45 — see background-music.md:90), pure-music
// videos sit near full at 0.7–0.9 to clear the encoder noise floor (line 31).
// 0.5 is the mid of the simplest under-VO hold-low band; 0.9 is the top of the
// pure-music band. Agents wanting per-section ducking embed the same id twice
// at different volumes (pattern 2 in background-music.md) — the assembler's
// single-bed BGM emit is the floor, not the ceiling.
const hasPerSceneVoice = playOrder.some(
  ({ scene }) => scene.voicePath && existsSync(join(hyperframesDir, scene.voicePath)),
);
const hasAnyVoice = hasGlobalVoice || (voiceMode === "per-scene" && hasPerSceneVoice);
const BGM_VOLUME = hasAnyVoice ? "0.5" : "0.9";

// ---------- build <body> elements in track order ----------
const body = [];
let voiceCount = 0;

for (let i = 0; i < playOrder.length; i++) {
  const { sid, scene } = playOrder[i];
  const start = scene.start_s;
  const dur = scene.estimatedDuration_s;
  // Voice clips share track 10 (single-lane). start_s is prep.mjs's cumulative
  // sum of estimatedDuration_s, so (nextStart - start) IS the scene's own span —
  // this is NOT a semantic change, just a float-exact one: computing dur this way
  // makes the IEEE-754 sum (start + voiceDur) bit-exact equal to nextStart, which
  // avoids spurious StaticGuard "overlaps by 5e-16s" failures when two 3-decimal
  // floats sum off by a ULP (e.g. 1.771 + 3.648 = 5.4190000000000005 ≠ 5.419).
  // Last scene has no successor → fall back to its own duration.
  // (Root cause is the overlap guard lacking a float epsilon; this is the
  // assemble-layer workaround since the skill can't patch core lint.)
  const next = playOrder[i + 1];
  const voiceDur = next ? next.scene.start_s - start : dur;
  body.push(`      <!-- ${sid} (${start} → ${Number((start + dur).toFixed(3))}) -->`);
  // (track 0) scene sub-comp clip — host data-composition-id MUST equal the
  // inner file's data-composition-id (= sid) or the runtime never finds the
  // timeline. No class="clip" on sub-comp host divs (proven: brex / style-10).
  // When HyperShader is active, host also carries class="scene" + a literal
  // background-color matching shaderTransitions.bg_color (HyperShader uses
  // this for its compositing seams).
  const sceneClassAttr = useHyperShader ? ` class="scene"` : "";
  const sceneStyleAttr = useHyperShader && shaderTransitions.bg_color
    ? ` style="background-color: ${shaderTransitions.bg_color};"`
    : "";
  // HyperShader resolves scenes via getElementById(sid) and requires that same
  // element to carry class="scene" — so in shader mode the host div id must be
  // the bare sid (not the el-<sid> prefix), or init() throws "scene ids not
  // found in DOM". Non-shader mode keeps the el- prefix for host uniqueness.
  const sceneHostId = useHyperShader ? sid : `el-${sid}`;
  body.push(
    `      <div`,
    `        id="${sceneHostId}"${sceneClassAttr}`,
    `        data-composition-id="${sid}"`,
    `        data-composition-src="compositions/${sid}.html"`,
    `        data-start="${start}"`,
    `        data-duration="${dur}"`,
    `        data-track-index="0"`,
    `        data-width="${WIDTH}"`,
    `        data-height="${HEIGHT}"${sceneStyleAttr}`,
    `      ></div>`,
  );
  // (track 10) voice — per-scene emission only when voiceMode === "per-scene".
  // In w2h's default "global" voice mode the single narration <audio> is
  // emitted ONCE after the scene loop instead.
  if (voiceMode === "per-scene") {
    if (scene.voicePath && existsSync(join(hyperframesDir, scene.voicePath))) {
      body.push(
        `      <audio`,
        `        id="el-${sid}-voice"`,
        `        class="clip"`,
        `        src="${scene.voicePath}"`,
        `        data-start="${start}"`,
        `        data-duration="${voiceDur}"`,
        `        data-track-index="10"`,
        `      ></audio>`,
      );
      voiceCount++;
    } else if (scene.voicePath) {
      anomalies.push(`${sid}: voicePath "${scene.voicePath}" not on disk — skipped voice <audio>`);
    }
  }
  body.push("");
}

// (track 10) global narration — w2h's default voice path. One <audio> spans
// the segment specified by group_spec.voice.{start_s, duration_s}.
if (voiceMode === "global" && globalVoicePath) {
  if (hasGlobalVoice) {
    const vStart = Number(globalVoice.start_s ?? 0);
    const vDur = Number(globalVoice.duration_s ?? totalDuration - vStart);
    const vVol = globalVoice.volume != null ? globalVoice.volume : 1;
    const vTrack = globalVoice.track_index != null ? globalVoice.track_index : 10;
    body.push(
      `      <!-- narration (global voice) -->`,
      `      <audio`,
      `        id="el-narration"`,
      `        class="clip"`,
      `        src="${globalVoicePath}"`,
      `        data-start="${vStart}"`,
      `        data-duration="${vDur}"`,
      `        data-track-index="${vTrack}"`,
      `        data-volume="${vVol}"`,
      `      ></audio>`,
      "",
    );
    voiceCount = 1;
  } else {
    anomalies.push(
      `global voice path "${globalVoicePath}" not on disk — skipped narration <audio>`,
    );
  }
}

// (track 11) BGM — Lyria is spawned detached and may not have landed yet, so
// re-check disk here (group_spec / audio_meta only promise the path).
let bgmEmitted = false;
const bgmPath = groupSpec.bgm_path;
if (bgmPath) {
  if (existsSync(join(hyperframesDir, bgmPath))) {
    body.push(
      `      <!-- BGM -->`,
      `      <audio`,
      `        id="el-bgm"`,
      `        class="clip"`,
      `        src="${bgmPath}"`,
      `        data-start="0"`,
      `        data-duration="${totalDuration}"`,
      `        data-track-index="11"`,
      `        data-volume="${BGM_VOLUME}"`,
      `      ></audio>`,
      "",
    );
    bgmEmitted = true;
  } else {
    anomalies.push(`bgm_path "${bgmPath}" not on disk (still rendering?) — skipped BGM <audio>`);
  }
}

// (track 12) captions — captions agent writes this or skips; key off existence.
let captionsEmitted = false;
if (existsSync(join(hyperframesDir, "compositions/captions.html"))) {
  body.push(
    `      <!-- captions -->`,
    `      <div`,
    `        id="el-captions"`,
    `        data-composition-id="captions"`,
    `        data-composition-src="compositions/captions.html"`,
    `        data-start="0"`,
    `        data-duration="${totalDuration}"`,
    `        data-track-index="12"`,
    `        data-width="${WIDTH}"`,
    `        data-height="${HEIGHT}"`,
    `      ></div>`,
    "",
  );
  captionsEmitted = true;
}

// (track 20+i) SFX — emitted verbatim from group_spec.sfx[] (already sorted by
// t, file checked against the manifest, duration locked to manifest truth by
// prep). Correct-by-construction; verify-output.mjs sfx re-asserts this against the
// emitted html as the orchestrator's deterministic gate.
const sfx = Array.isArray(groupSpec.sfx) ? groupSpec.sfx : [];
let sfxEmitted = 0;
sfx.forEach((cue, i) => {
  const rel = `assets/sfx/${cue.file}`;
  if (!existsSync(join(hyperframesDir, rel))) {
    anomalies.push(
      `sfx "${cue.file}" not on disk at ${rel} — skipped (prep should have copied it)`,
    );
    return;
  }
  // SFX default: play at natural catalog-normalized level. The catalog is
  // loudness-normalized at the file level, so emitting no `data-volume`
  // attribute (= 1.0) lets clips ring as-recorded. Agents can still set
  // `cue.volume` explicitly to nudge a specific clip — that override is
  // honored. Even when multiple SFX overlap or stack with VO, the resulting
  // mix is the catalog's natural sum (no auto-duck, by design).
  if (sfxEmitted === 0) body.push(`      <!-- SFX -->`);
  const lines = [
    `      <audio`,
    `        id="el-sfx-${i}"`,
    `        class="clip"`,
    `        src="${rel}"`,
    `        data-start="${cue.t}"`,
    `        data-duration="${cue.duration}"`,
    `        data-track-index="${20 + i}"`,
  ];
  // `cue.media_start` lets a clip skip dead air at the head (set from the
  // `sfx add` analysis's `onsetSec`). Aligning audible-onset to `data-start`
  // is the timing-alignment knob the volume change preserves.
  if (cue.media_start != null) lines.push(`        data-media-start="${cue.media_start}"`);
  if (cue.volume != null) lines.push(`        data-volume="${cue.volume}"`);
  lines.push(`      ></audio>`);
  body.push(...lines);
  sfxEmitted++;
});

// ---------- <head> style: proven base + optional @font-face block ----------
const fontFaceCss = (groupSpec.font_face_css || "").trim();
const headStyle = [
  "      * {",
  "        margin: 0;",
  "        padding: 0;",
  "        box-sizing: border-box;",
  "      }",
  "      html,",
  "      body {",
  "        margin: 0;",
  `        width: ${WIDTH}px;`,
  `        height: ${HEIGHT}px;`,
  "        overflow: hidden;",
  "        background: #000;",
  "      }",
  "      #root {",
  "        position: relative;",
  `        width: ${WIDTH}px;`,
  `        height: ${HEIGHT}px;`,
  "        overflow: hidden;",
  "      }",
  "      /* Sub-comp slots stretch to fill the root */",
  "      #root > div[data-composition-src] {",
  "        position: absolute;",
  "        inset: 0;",
  "      }",
];
if (fontFaceCss) {
  headStyle.push("", "      /* Brand fonts (extracted by prep.mjs from design.html) */");
  for (const line of fontFaceCss.split("\n")) headStyle.push(`      ${line}`);
}

// ---------- assemble document ----------
// w2h adaptation: when useHyperShader, include hyper-shader-local.js after
// GSAP and replace the vanilla timeline bootstrap with HyperShader.init().
const shaderScriptTag = useHyperShader
  ? `\n    <script src="hyper-shader-local.js"></script>`
  : "";

const bootstrapScript = useHyperShader
  ? `      var tl = HyperShader.init(${JSON.stringify(
      {
        bgColor: shaderTransitions.bg_color || "#000000",
        ...(shaderTransitions.accent_color ? { accentColor: shaderTransitions.accent_color } : {}),
        scenes: shaderTransitions.scenes || [],
        transitions: shaderTransitions.transitions || [],
      },
      null,
      8,
    )
      .split("\n")
      .map((l, i) => (i === 0 ? l : "      " + l))
      .join("\n")});
      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = tl;`
  : `      window.__timelines = window.__timelines || {};
      window.__timelines["main"] = gsap.timeline({ paused: true });`;

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${WIDTH}, height=${HEIGHT}" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>${shaderScriptTag}
    <style>
${headStyle.join("\n")}
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${totalDuration}"
      data-width="${WIDTH}"
      data-height="${HEIGHT}"
    >
${body.join("\n")}
    </div>

    <script>
${bootstrapScript}
    </script>
  </body>
</html>
`;

writeFileSync(outPath, html);

// ---------- caption-overrides.json shim ----------
// The captions runtime fetches this file at validate time; absence yields a
// noisy validate ✗ that previously sent finalize on a ~30s debug chase. An
// empty array is a no-op override list — semantically identical to absent —
// but the file existing silences validate. preflight-finalize.mjs writes the
// same shim defensively in case this engine is bypassed on a resume path.
const captionOverridesPath = join(hyperframesDir, "caption-overrides.json");
let captionOverridesCreated = false;
if (!existsSync(captionOverridesPath)) {
  writeFileSync(captionOverridesPath, "[]\n");
  captionOverridesCreated = true;
}

// ---------- summary ----------
console.log(`✓ wrote ${outPath}`);
console.log(`  composition:        ${WIDTH}x${HEIGHT}`);
console.log(`  scenes (track 0):   ${playOrder.length}`);
console.log(
  `  voice  (track 10):  ${voiceCount}${voiceMode === "global" ? " (global mode)" : " (per-scene mode)"}`,
);
console.log(`  bgm    (track 11):  ${bgmEmitted ? `yes (vol ${BGM_VOLUME})` : "no"}`);
console.log(`  captions (track 12): ${captionsEmitted ? "yes" : "no"}`);
console.log(
  `  sfx    (track 20+):  ${sfxEmitted}${sfx.length !== sfxEmitted ? ` (${sfx.length - sfxEmitted} skipped)` : ""}`,
);
console.log(`  total duration:     ${totalDuration}s`);
console.log(`  @font-face:         ${fontFaceCss ? `${fontFaceCss.length}B injected` : "none"}`);
console.log(
  `  hyper-shader:       ${useHyperShader ? `yes (${shaderTransitions.scenes.length} scene(s), ${shaderTransitions.transitions.length} transition(s))` : "no (vanilla GSAP)"}`,
);
if (captionOverridesCreated) console.log(`  caption-overrides.json: created empty [] shim`);
if (anomalies.length) {
  console.log(`\nanomalies (non-fatal):`);
  for (const a of anomalies) console.log(`  - ${a}`);
}
