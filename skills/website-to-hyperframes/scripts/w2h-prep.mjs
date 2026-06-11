#!/usr/bin/env node
// w2h-prep.mjs — emit group_spec.json + design-system chunks from w2h project state.
//
// w2h's equivalent of plv2's prep.mjs: a deterministic Node script that
// produces the artifacts downstream gates read. Unlike plv2, w2h has no
// upstream "dispatch packet" with start_s/estimatedDuration_s pre-computed —
// the source of truth for beat timing is the on-disk composition files
// themselves (`compositions/beat-N-<slug>.html` carry `data-duration` on
// their root `<div data-composition-id="...">`).
//
// PORT 0 v2. Emits the plv2-compatible artifacts captions.mjs + downstream
// gates need:
//
//   1. ./group_spec.json
//      { total_duration_s, canvas:{width,height}, captions_enabled, sfx[],
//        groups: [ { scene_ids:[<sid>...],
//                    scenes: { <sid>: { id, file, start_s,
//                                        estimatedDuration_s, duration_s,
//                                        surface, wordsPath } } } ],
//        asset_check: { total_references, unique_assets, missing[] },
//        shader_transitions?: { bg_color, accent_color?, scenes[],
//                               transitions:[{time, duration, shader?}] } }
//
//      `asset_check` (PHASE C(a)): scans each beat HTML for capture/assets/X
//      references, verifies each resolves to a file on disk. Empty missing[] is
//      the happy path; preflight-finalize can promote missing assets to fail.
//
//      `shader_transitions` (PHASE C(b)): parsed from a "## Shader Transitions"
//      block in STORYBOARD.md with lines of the form
//      `- between <beat-id> and <beat-id>: shader=<name>[, duration=<n>]`.
//      Field is OMITTED when no transitions are declared (assembler falls
//      through to vanilla GSAP bootstrap, no HyperShader). When ANY are
//      declared, the full scenes/transitions chain is emitted with the
//      declared shaders on declared boundaries and CSS crossfade on the rest.
//
//   2. ./design-system/chunks/tokens.css   — :root { --font-*, --canvas, --ink, --brand-primary }
//      Parsed from DESIGN.md when present; otherwise sane w2h defaults.
//      captions.mjs inlines this verbatim into compositions/captions.html
//      and rewrites the skin's bare hex/rgba into var(--*) refs against it.
//
//   3. ./design-system/inference.json     — { site_dna:{voice_tone}, selected:{name} }
//      Drives captions.mjs skin scoring. Defaults to neutral tone +
//      default preset name (ties go to pill-karaoke per captions.mjs rubric).
//
//   4. ./assets/voice/<sid>_words.json    — per-scene word splits of transcript.json
//      Only emitted when transcript.json exists at project root. Words are
//      partitioned by global start_s into the scene whose [start, start+dur)
//      window they fall into. Per-scene timestamps are normalized to
//      scene-local seconds (subtract scene start_s). If no transcript.json,
//      every scene gets wordsPath:"" and captions cleanly no-op.
//
// Single group is the w2h norm (no Tier-A bridges, no cap=2 worker grouping)
// — every beat sits in groups[0].
//
// Anti-recommendation respected (per port-verify workflow w0cjhx3v9):
// Do NOT port plv2's full prep.mjs verbatim — it reads a multi-act dispatch
// packet w2h doesn't produce. Port the OUTPUT shape only.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve, basename, extname } from "node:path";

function parseArgs(argv) {
  const args = { hyperframes: ".", out: "./group_spec.json" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--hyperframes") args.hyperframes = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

function usage() {
  console.log(
    [
      "Usage: node w2h-prep.mjs [--hyperframes <projectDir>] [--out <path>]",
      "",
      "Walks <projectDir>/compositions/ for beat compositions, extracts each",
      "beat's data-duration, emits group_spec.json plus design-system chunks",
      "(tokens.css + inference.json) and splits transcript.json per scene.",
      "",
      "Defaults: --hyperframes .  --out ./group_spec.json",
    ].join("\n"),
  );
}

// Host-div extractor — matches a single <div ...> opening tag (multi-line
// tolerant) and pulls out data-composition-id + data-duration in any attribute
// order. Used to scan index.html for the canonical per-beat durations, since
// w2h beats keep `data-duration` on the host div in index.html (not on the
// sub-comp root inside compositions/<sid>.html).
const TAG_RE = /<div\b[^>]*?>/gis;
const ATTR = (s, name) => {
  const m = s.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return m ? m[1] : null;
};

function scanIndexHtmlHostDivs(indexHtml) {
  const hosts = new Map(); // composition_id → duration_s
  let m;
  while ((m = TAG_RE.exec(indexHtml)) !== null) {
    const tag = m[0];
    const cid = ATTR(tag, "data-composition-id");
    const dur = ATTR(tag, "data-duration");
    if (!cid || !dur) continue;
    const n = parseFloat(dur);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (!hosts.has(cid)) hosts.set(cid, n);
  }
  return hosts;
}

// Sub-comp root extractor — fallback only, when index.html doesn't carry a
// host div for this composition (rare; happens in monolithic Cell-D/E/F
// styles which w2h is moving away from per Session 4's architecture-split kill).
function extractCompositionRootDuration(html) {
  const tagMatch = html.match(TAG_RE);
  if (!tagMatch) return null;
  for (const tag of tagMatch) {
    const cid = ATTR(tag, "data-composition-id");
    const dur = ATTR(tag, "data-duration");
    if (cid && dur) {
      const n = parseFloat(dur);
      if (Number.isFinite(n) && n > 0) return { id: cid, duration_s: n };
    }
  }
  return null;
}

// ─── Asset-existence pre-flight (PHASE C(a)) ─────────────────────────────
// Scan each beat HTML for `capture/assets/...` references in src=, xlink:href=,
// and CSS url(). Verify each unique path resolves to a file on disk relative to
// the project root. Returns a summary the orchestrator can surface AND that
// downstream gates (preflight-finalize, perception) can use to flag missing
// assets before render.
//
// Strategy: catch absent assets BEFORE the agent renders a 30-second MP4 that
// 404s a logo, not after. The renderer fails silently on missing images at
// snapshot time — the perception gate's blind spot — so this prep-time check
// is the cheapest place to catch it.
const ASSET_REF_RE =
  /(?:src|xlink:href)\s*=\s*["']([^"']*\bcapture\/assets\/[^"']+)["']|url\(\s*["']?(capture\/assets\/[^"')]+)["']?\s*\)/gi;

function verifyAssetReferences(projectDir, scenes) {
  const missing = new Map(); // path → [beat ids that reference it]
  const seen = new Set();
  let total = 0;
  for (const s of scenes) {
    const abs = resolve(projectDir, s.file);
    let html;
    try {
      html = readFileSync(abs, "utf-8");
    } catch {
      continue;
    }
    let m;
    while ((m = ASSET_REF_RE.exec(html)) !== null) {
      const p = m[1] || m[2];
      if (!p) continue;
      total++;
      if (seen.has(p)) continue;
      seen.add(p);
      const onDisk = resolve(projectDir, p);
      if (!existsSync(onDisk)) {
        if (!missing.has(p)) missing.set(p, []);
        if (!missing.get(p).includes(s.id)) missing.get(p).push(s.id);
      }
    }
  }
  return {
    total_references: total,
    unique_assets: seen.size,
    missing: Array.from(missing, ([path, beats]) => ({ path, beats })),
  };
}

// ─── Shader-transitions auto-derive (PHASE C(b)) ─────────────────────────
// Parse a canonical "Shader Transitions" block in STORYBOARD.md. Each line
// matches:
//   - between <beat-id> and <beat-id>: shader=<name>[, duration=<n>]
// Returns the assembler-shaped object, or null if no transitions are declared
// (in which case prep omits shader_transitions and the assembler falls through
// to vanilla GSAP bootstrap). When ANY transition is declared, the full chain
// is emitted: declared boundaries get the named shader, undeclared adjacent
// boundaries get CSS crossfade (no shader field). Invariant enforced:
// scenes.length === transitions.length + 1.
const SHADER_TRANSITION_RE =
  /between\s+(beat-[a-z0-9_-]+|s-end)\s+and\s+(beat-[a-z0-9_-]+|s-end)\s*:\s*shader\s*=\s*([a-z][-a-z0-9_]*)(?:\s*,\s*duration\s*=\s*([0-9.]+))?/gi;

function parseShaderTransitions(projectDir, scenes, bgColor, accentColor) {
  const storyPath = join(projectDir, "STORYBOARD.md");
  if (!existsSync(storyPath)) return null;
  const text = readFileSync(storyPath, "utf-8");

  const declared = new Map(); // `${from}::${to}` → { shader, duration }
  let m;
  while ((m = SHADER_TRANSITION_RE.exec(text)) !== null) {
    declared.set(`${m[1]}::${m[2]}`, {
      shader: m[3],
      duration: m[4] ? parseFloat(m[4]) : 0.5,
    });
  }
  if (declared.size === 0) return null;

  // Build the full transitions chain over scenes[N-1] → scenes[N] pairs.
  // Declared boundaries get the named shader; undeclared get a CSS crossfade.
  const sceneIds = scenes.map((s) => s.id);
  const transitions = [];
  for (let i = 0; i < scenes.length - 1; i++) {
    const fromId = scenes[i].id;
    const toId = scenes[i + 1].id;
    const decl = declared.get(`${fromId}::${toId}`);
    const time = Number((scenes[i].start_s + scenes[i].duration_s).toFixed(3));
    transitions.push({
      time,
      duration: decl?.duration ?? 0.5,
      ...(decl?.shader ? { shader: decl.shader } : {}),
    });
  }

  const result = { bg_color: bgColor, scenes: sceneIds, transitions };
  if (accentColor) result.accent_color = accentColor;
  return result;
}

function scanCompositionsDir(projectDir) {
  const compDir = join(projectDir, "compositions");
  if (!existsSync(compDir)) return [];

  // Build hostDur map from index.html if present. This is the canonical
  // source for per-beat durations — w2h's sub-comp model keeps timing on the
  // host div in index.html, not on the sub-comp's own root.
  const indexPath = join(projectDir, "index.html");
  const hostDur = existsSync(indexPath)
    ? scanIndexHtmlHostDivs(readFileSync(indexPath, "utf-8"))
    : new Map();

  const scenes = [];
  for (const f of readdirSync(compDir).sort()) {
    if (extname(f) !== ".html") continue;
    if (f === "captions.html") continue; // captions sub-comp doesn't count as a beat
    const file = join("compositions", f);
    const abs = resolve(projectDir, file);
    const html = readFileSync(abs, "utf-8");

    // Find the sub-comp's own root data-composition-id (multi-line tolerant).
    // We need the id; duration may come from the host div instead.
    const subRoot = extractCompositionRootDuration(html);
    let id, duration_s;
    if (subRoot && hostDur.has(subRoot.id)) {
      // Sub-comp root has both id + duration AND index.html host carries it too.
      // Trust index.html — that's what the assembler/renderer uses.
      id = subRoot.id;
      duration_s = hostDur.get(subRoot.id);
    } else if (subRoot) {
      // Sub-comp root has both, but no host. Use sub-comp's own value.
      id = subRoot.id;
      duration_s = subRoot.duration_s;
    } else {
      // Sub-comp root has no data-duration (w2h cell-A pattern). Recover the
      // composition_id from the sub-comp's opening tag (multi-line tolerant)
      // and look up the host div in index.html.
      const tagMatch = html.match(TAG_RE);
      if (tagMatch) {
        for (const tag of tagMatch) {
          const cid = ATTR(tag, "data-composition-id");
          if (cid && hostDur.has(cid)) {
            id = cid;
            duration_s = hostDur.get(cid);
            break;
          }
        }
      }
    }
    if (!id || !duration_s) {
      console.warn(
        `! ${file} — could not resolve duration. Looked at sub-comp data-duration ` +
          `and index.html host div (id="${subRoot?.id || basename(f, ".html")}"). Skipping.`,
      );
      continue;
    }
    scenes.push({ id, file, duration_s });
  }
  return scenes;
}

// ─── @font-face aggregation (for check-rendered-perception.mjs) ──────────
// Perception script injects a font_face_css blob into each probe page so
// rendered text measures with the right metrics. Scan index.html (if present)
// + each compositions/beat-*.html for `@font-face { ... }` blocks, dedupe by
// font-family+font-weight key, return one concatenated string.

const FONT_FACE_RE = /@font-face\s*\{[^}]*\}/gi;
const FF_FAMILY_RE = /font-family\s*:\s*['"]?([^;'"}]+)['"]?\s*;?/i;
const FF_WEIGHT_RE = /font-weight\s*:\s*([^;}]+);?/i;

function aggregateFontFaceCss(projectDir, scenes) {
  const seen = new Map(); // key=family+weight → block
  const filesToScan = [];
  const rootIndex = join(projectDir, "index.html");
  if (existsSync(rootIndex)) filesToScan.push(rootIndex);
  for (const s of scenes) filesToScan.push(resolve(projectDir, s.file));

  for (const f of filesToScan) {
    const html = readFileSync(f, "utf-8");
    const blocks = html.match(FONT_FACE_RE) || [];
    for (const block of blocks) {
      const fam = (block.match(FF_FAMILY_RE) || [])[1]?.trim().toLowerCase() || "";
      const wt = (block.match(FF_WEIGHT_RE) || [])[1]?.trim() || "normal";
      const key = `${fam}|${wt}`;
      if (!fam) continue;
      if (!seen.has(key)) seen.set(key, block);
    }
  }
  if (seen.size === 0) return "";
  return [...seen.values()].join("\n\n");
}

// ─── DESIGN.md → tokens ───────────────────────────────────────────────────
// Parse DESIGN.md prose for the brand primary color + display/body font
// family names. Best-effort regex; falls back to w2h defaults when DESIGN.md
// is absent or doesn't carry these in a parseable form.

const DESIGN_DEFAULTS = {
  fontDisplay: "Inter",
  fontBody: "Inter",
  fontMono: "JetBrains Mono",
  canvas: "#ffffff",
  ink: "#0a0a0a",
  brandPrimary: "#3139FB", // generic w2h placeholder; rewritten if DESIGN.md provides
};

function parseDesignTokens(projectDir) {
  const designPath = join(projectDir, "DESIGN.md");
  const tokens = { ...DESIGN_DEFAULTS };
  if (!existsSync(designPath)) return tokens;
  const md = readFileSync(designPath, "utf-8");

  // Hex color extraction: pick the first 6-digit hex that looks like a brand
  // color (not pure white/black). DESIGN.md format from step-1-design.md
  // typically lists colors as `- Primary: #3139FB` or in a Colors section.
  const hexes = (md.match(/#[0-9a-fA-F]{6}\b/g) || [])
    .map((h) => h.toLowerCase())
    .filter((h) => h !== "#ffffff" && h !== "#000000");
  if (hexes.length > 0) tokens.brandPrimary = hexes[0];

  // Font family extraction. Look for explicit font-family-style lines.
  // DESIGN.md format: `- Display: "Aeonik"` or `font-family: "GT Walsheim"`.
  const fontLines = md.match(/font[-_\s]?family\s*:?\s*["']?([A-Z][\w\s]+)["']?/gi) || [];
  if (fontLines.length > 0) {
    const first = fontLines[0].match(/["']([^"']+)["']/) || fontLines[0].match(/:\s*(\S[\w\s]+)/);
    if (first && first[1]) tokens.fontDisplay = first[1].trim();
  }

  // Canvas + ink override: if DESIGN.md mentions a dark theme, swap.
  if (/\bdark\s*(?:theme|background|mode)/i.test(md)) {
    tokens.canvas = "#0a0a0a";
    tokens.ink = "#ffffff";
  }

  return tokens;
}

function emitTokensCss(projectDir, tokens) {
  const chunksDir = join(projectDir, "design-system", "chunks");
  mkdirSync(chunksDir, { recursive: true });
  const tokensPath = join(chunksDir, "tokens.css");
  const css = [
    "/* Generated by w2h-prep.mjs from DESIGN.md (or w2h defaults).",
    "   Consumed by captions.mjs html (inlined into compositions/captions.html).",
    "   captions.mjs rewrites the registry skin's bare hex/rgba into var(--*)",
    "   references against these tokens. */",
    ":root {",
    `  --font-display: "${tokens.fontDisplay}";`,
    `  --font-body: "${tokens.fontBody}";`,
    `  --font-mono: "${tokens.fontMono}";`,
    `  --canvas: ${tokens.canvas};`,
    `  --ink: ${tokens.ink};`,
    `  --brand-primary: ${tokens.brandPrimary};`,
    "}",
    "",
  ].join("\n");
  writeFileSync(tokensPath, css);
  return tokensPath;
}

function emitInferenceJson(projectDir, tokens) {
  const dsDir = join(projectDir, "design-system");
  mkdirSync(dsDir, { recursive: true });
  const inferencePath = join(dsDir, "inference.json");
  // Default voice_tone=neutral biases captions.mjs skin scoring toward
  // pill-karaoke (ties resolve to pill-karaoke per captions.mjs:621).
  // selected.name="w2h-default" is informational; captions.mjs only uses it
  // for LOUD_PRESETS regex which is plv2-specific and won't match.
  const inference = {
    site_dna: { voice_tone: "neutral" },
    selected: { name: "w2h-default" },
    brand_primary: tokens.brandPrimary,
    font_display: tokens.fontDisplay,
  };
  writeFileSync(inferencePath, JSON.stringify(inference, null, 2) + "\n");
  return inferencePath;
}

// ─── transcript.json → per-scene words ────────────────────────────────────
// captions.mjs reads `assets/voice/<sid>_words.json` for each scene that
// claims a wordsPath. Format: [{text, start, end}, ...] in SCENE-LOCAL
// seconds. Partition global transcript by each scene's [start_s,
// start_s+duration_s) window, normalize timestamps by subtracting start_s.

function splitTranscriptPerScene(projectDir, scenes) {
  const transcriptPath = join(projectDir, "transcript.json");
  if (!existsSync(transcriptPath)) {
    return new Map(scenes.map((s) => [s.id, ""]));
  }
  let words;
  try {
    words = JSON.parse(readFileSync(transcriptPath, "utf-8"));
  } catch (e) {
    console.warn(`! transcript.json is not valid JSON (${e.message}); all wordsPath empty`);
    return new Map(scenes.map((s) => [s.id, ""]));
  }
  if (!Array.isArray(words)) {
    console.warn(`! transcript.json is not an array; all wordsPath empty`);
    return new Map(scenes.map((s) => [s.id, ""]));
  }

  const wordsDir = join(projectDir, "assets", "voice");
  mkdirSync(wordsDir, { recursive: true });

  const out = new Map();
  for (const s of scenes) {
    const sceneStart = s.start_s;
    const sceneEnd = sceneStart + s.duration_s;
    const sceneWords = [];
    for (const w of words) {
      const wStart = typeof w.start === "number" ? w.start : null;
      const wEnd = typeof w.end === "number" ? w.end : null;
      const wText = w.text != null ? String(w.text) : "";
      if (wStart == null || wEnd == null || !wText) continue;
      // Word belongs to this scene if its onset falls inside the scene window.
      if (wStart >= sceneStart && wStart < sceneEnd) {
        sceneWords.push({
          text: wText,
          start: Number((wStart - sceneStart).toFixed(3)),
          end: Number((Math.min(wEnd, sceneEnd) - sceneStart).toFixed(3)),
        });
      }
    }
    if (sceneWords.length === 0) {
      out.set(s.id, "");
      continue;
    }
    const rel = join("assets", "voice", `${s.id}_words.json`);
    writeFileSync(join(projectDir, rel), JSON.stringify(sceneWords, null, 2) + "\n");
    out.set(s.id, rel);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    process.exit(0);
  }
  const projectDir = resolve(args.hyperframes);
  const outPath = resolve(projectDir, args.out);

  const flatScenes = scanCompositionsDir(projectDir);
  if (flatScenes.length === 0) {
    console.error(
      `✗ w2h-prep: no beat compositions found at ${join(projectDir, "compositions")}/. ` +
        "Have you run Step 5 (build) yet? Each beat must be a compositions/beat-*.html " +
        "file with a root <div data-composition-id=... data-duration=...>.",
    );
    process.exit(1);
  }

  // Compute cumulative start_s for each scene (in array order).
  let cursor = 0;
  for (const s of flatScenes) {
    s.start_s = Number(cursor.toFixed(3));
    s.estimatedDuration_s = Number(s.duration_s.toFixed(3));
    cursor += s.duration_s;
  }
  const totalDuration = Number(cursor.toFixed(3));

  // DESIGN.md → tokens + inference.json (consumed by captions.mjs).
  const tokens = parseDesignTokens(projectDir);
  const tokensPath = emitTokensCss(projectDir, tokens);
  const inferencePath = emitInferenceJson(projectDir, tokens);

  // Asset-existence pre-flight (PHASE C(a)).
  const assetCheck = verifyAssetReferences(projectDir, flatScenes);

  // STORYBOARD.md → shader_transitions, if a canonical block is present
  // (PHASE C(b)). When absent, the orchestrator can still add the field
  // manually before invoking assemble-index — same contract as before.
  const shaderTransitions = parseShaderTransitions(projectDir, flatScenes, tokens.canvas, tokens.brandPrimary);

  // transcript.json → per-scene words splits.
  const wordsPaths = splitTranscriptPerScene(projectDir, flatScenes);

  // Build the groups[] shape captions.mjs (and downstream gates) consume.
  // Single group is the w2h norm — no Tier-A bridges, no cap=2 grouping.
  const sceneIds = flatScenes.map((s) => s.id);
  const scenesMap = {};
  for (const s of flatScenes) {
    scenesMap[s.id] = {
      id: s.id,
      file: s.file,
      start_s: s.start_s,
      estimatedDuration_s: s.estimatedDuration_s,
      duration_s: s.duration_s, // legacy alias for backward compat
      surface: "default",
      wordsPath: wordsPaths.get(s.id) || "",
    };
  }

  const fontFaceCss = aggregateFontFaceCss(projectDir, flatScenes);

  // v5: detect a global narration audio at project root. assemble-index reads
  // `voice` (top-level) when --voice-mode=global (its default for w2h). If no
  // narration file is found, omit the field — assemble-index treats absence as
  // "no narration" and skips the audio tag emit cleanly.
  const voicePath = ["narration.wav", "narration.mp3"]
    .map((f) => ({ rel: f, abs: join(projectDir, f) }))
    .find((p) => existsSync(p.abs));
  const voice = voicePath
    ? {
        path: voicePath.rel,
        start_s: 0,
        duration_s: totalDuration,
        volume: 1,
      }
    : undefined;

  const spec = {
    total_duration_s: totalDuration,
    total_scenes: flatScenes.length,
    // canvas: legacy alias kept for backward compat with verify-output + perception
    canvas: { width: 1920, height: 1080 },
    // composition: assemble-index reads this for --voice-mode=global resolution
    // param. Override at orchestrator time for portrait/square comps by editing
    // group_spec.json after w2h-prep emits the default.
    composition: { width: 1920, height: 1080, fps: 30 },
    font_face_css: fontFaceCss,
    captions_enabled: existsSync(join(projectDir, "compositions/captions.html")),
    sfx: [],
    ...(voice ? { voice } : {}),
    // shader_transitions auto-derived from STORYBOARD.md "Shader Transitions"
    // block (PHASE C(b)). Canonical line format:
    //   - between beat-X and beat-Y: shader=<name>[, duration=<n>]
    // When the storyboard declares ANY transition, prep emits the full
    // scenes/transitions chain (declared boundaries get the shader; the
    // others fall through to CSS crossfade). When the storyboard declares
    // NONE, this field is omitted entirely and assemble-index falls through
    // to vanilla GSAP bootstrap. Invariant: scenes.length === transitions.length + 1.
    // Orchestrator can still override or add this manually before invoking
    // assemble-index — same backward-compatible contract as before.
    ...(shaderTransitions ? { shader_transitions: shaderTransitions } : {}),
    // asset_check: surface of `capture/assets/X` references that don't
    // resolve on disk. Empty `missing[]` is the happy path. preflight-finalize
    // can promote missing assets to a hard fail; for now prep warns.
    asset_check: assetCheck,
    groups: [{ scene_ids: sceneIds, scenes: scenesMap }],
    // Flat scenes[] kept for human readability + legacy verify-output.mjs
    // backward compat (verify-output only reads total_duration_s + sfx[], so
    // it doesn't actually depend on this — but humans glancing at the file
    // benefit from a flat list).
    scenes: flatScenes.map((s) => ({
      id: s.id,
      file: s.file,
      start_s: s.start_s,
      duration_s: s.duration_s,
    })),
  };

  writeFileSync(outPath, JSON.stringify(spec, null, 2) + "\n");
  const transcribed = [...wordsPaths.values()].filter(Boolean).length;
  console.log(
    `✓ w2h-prep: wrote ${args.out} — ${flatScenes.length} scene(s), ` +
      `total_duration_s=${spec.total_duration_s}, captions_enabled=${spec.captions_enabled}`,
  );
  console.log(`  + ${tokensPath.replace(projectDir + "/", "")} (brand-primary=${tokens.brandPrimary})`);
  console.log(`  + ${inferencePath.replace(projectDir + "/", "")}`);
  if (transcribed > 0) {
    console.log(`  + assets/voice/*_words.json (${transcribed}/${flatScenes.length} scenes have words)`);
  }
  if (fontFaceCss.length > 0) {
    const fontCount = (fontFaceCss.match(/@font-face/g) || []).length;
    console.log(`  + font_face_css (${fontCount} @font-face block(s) aggregated for perception probe)`);
  }
  if (voice) {
    console.log(`  + voice (${voice.path}, ${voice.duration_s}s)`);
  }
  if (shaderTransitions) {
    const namedCount = shaderTransitions.transitions.filter((t) => t.shader).length;
    console.log(
      `  + shader_transitions (${namedCount}/${shaderTransitions.transitions.length} named shader transitions from STORYBOARD.md)`,
    );
  }
  if (assetCheck.unique_assets > 0) {
    console.log(
      `  + asset_check (${assetCheck.unique_assets} unique assets referenced, ${assetCheck.total_references} total references)`,
    );
  }
  if (assetCheck.missing.length > 0) {
    console.warn(`! w2h-prep: ${assetCheck.missing.length} referenced asset(s) missing on disk:`);
    for (const m of assetCheck.missing) {
      console.warn(`    ✗ ${m.path}  (referenced by: ${m.beats.join(", ")})`);
    }
    console.warn("  These will 404 at render time. Fix the path or capture the asset.");
  }
}

main();
