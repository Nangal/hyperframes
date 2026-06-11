# Step 6: Validate & Deliver

This is the quality gate. Before the user sees anything, YOU verify that the video matches the storyboard, the creative direction from Step 2, and DESIGN.md. Deliver something you'd be proud to post with your name on it.

## Definition of Done — required before ANY preview or summary

**You may not say the video is ready, looks good, or present a preview URL until every item below is checked.** No exceptions. Do not summarize your impressions — paste the actual evidence for each.

Score each item 1–5. If any item scores below 3, fix it before continuing. **Do not rush these.** Each checkbox is its own pass through the artifacts — slow down, look at every frame, write the actual observation, not a summary impression.

```
[ ] Every beat HTML read top-to-bottom    → see "Per-beat file read" below; paste the per-beat verdict
[ ] Lint: zero errors                     → paste the lint output (not "lint passed")
[ ] Snapshot taken, N frames confirmed    → state the exact frame count
[ ] descriptions.md read in full          → quote the WORST frame Gemini described, verbatim
[ ] Contact sheet viewed cell-by-cell     → for EACH beat, one sentence: what's in frame, what's moving, what brand assets are present
[ ] No mid-video dark frames              → state explicitly which frames (if any) are dark and why
[ ] Brand assets actually visible         → for each beat, name which captured SVG / illustration / screenshot is on screen and at what timestamp. If a beat shows zero captured assets, justify why.
[ ] Audio duration matches video ±0.5s    → paste both numbers
[ ] Critic sub-agent run                  → paste its single biggest quality gap finding, verbatim
```

### Per-beat file read

This is what verification means now: you open each `compositions/beat-N.html` and read it top-to-bottom against DESIGN.md and STORYBOARD.md. Step 5 no longer runs this gate — it's owned here, one pass, not two.

For each beat, write a per-beat verdict in this form:

```
Beat N (Ns–Ns) — <name>
  CSS bg: <hex> (DESIGN.md says <hex>, matches: yes/no)
  CSS accent: <hex> (DESIGN.md says <hex>, matches: yes/no)
  Headline font-size: <px> (≥80: yes/no)
  Captured assets referenced: <list of paths from <img>, inline SVG, background-image> (storyboard called for: <list>)
  GSAP timeline coverage: events from <first t> to <last t>, beat duration <N>s (full coverage: yes/no)
  Storyboard alignment: <one sentence — does this beat deliver what its STORYBOARD.md section described>
  VERDICT: PASS / NEEDS FIX (<what specifically>)
```

The pre-fix-era flow took longer specifically because it caught these problems. Don't trade the careful look for a green checkmark.

**Why this matters:** The natural tendency is to look at a contact sheet, see that content is present, and declare it done. That is not verification — that is pattern-matching to a completion signal. Verification means opening every file the sub-agents produced, reading every line, and reporting the raw result. "Frame 7 at 14.2s shows the Raycast logo SVG drawing its final stroke at 0.85 opacity against #07080A, the headline 'Crush your sprint' has settled in 96px Inter SemiBold below" is evidence. "The video looks great" is not.

---

## Step 6.0 — Deterministic preflight (run first, before manual review)

Before opening any composition file by hand, run the deterministic preflight orchestrator. It composes lint + validate + inspect + caption keep-out + rendered-perception into a single Bash invocation with an exit-0/1/2 contract, and writes `finalize_brief.json` with each gate's pass/fail + edit-ready violation strings.

```bash
node skills/website-to-hyperframes/scripts/w2h-prep.mjs --hyperframes <project-dir>
node skills/website-to-hyperframes/scripts/preflight-finalize.mjs \
  --group-spec <project-dir>/group_spec.json \
  --hyperframes <project-dir> \
  --cli "npx tsx $(pwd)/packages/cli/src/cli.ts"
```

The `--cli "..."` flag pins which hyperframes binary the gates spawn internally. Always pass the local CLI form — without it, preflight falls back to `npx --yes hyperframes@<pinned-version>` (the published package, which may lag the worktree by weeks). You can also set `HYPERFRAMES_CLI` env once at session start instead of passing `--cli` every time:

```bash
export HYPERFRAMES_CLI="npx tsx $(pwd)/packages/cli/src/cli.ts"
```

What preflight runs internally (and why you don't run them manually anymore):

- `<cli> lint .` — replaces manual lint step.
- `<cli> validate .` — replaces manual validate step.
- `<cli> inspect . --samples <N>` — new gate. `N = max(18, scenes × 2)`.
- `captions.mjs keepout --json` — runs when captions are enabled; emits `edit_old`/`edit_new` Edit pairs per violation.
- `check-rendered-perception.mjs` — headless real-frame probe at 40%/70%/92% of each scene's duration. Soft-skips when puppeteer is missing.

**Exit code contract:**

- **`0`** — all gates passed (or you passed `--allow-gate-failure`). Proceed to manual review below.
- **`2`** — at least one of lint / validate / inspect produced a hard error. **STOP.** Do not patch in finalize — fix the upstream beat file (or re-dispatch its worker) and re-run preflight. Read `<project-dir>/finalize_brief.json`'s `gates.<gate>.output_tail` to diagnose.
- **`2`** (alt) — `--require-perception` is set and puppeteer is missing. Install puppeteer (`cd <project-dir> && npm i puppeteer`) or drop the flag.
- **`1`** — preflight itself crashed (most commonly: `group_spec.json` missing — run `w2h-prep.mjs` first).

**After preflight exits 0**, continue with the per-beat manual reads and critic sub-agent below. Preflight catches mechanical bugs (selector scope, contrast, cramped containers, text overflow, missing assets, timeline registration drift) but cannot judge whether the video tells the storyboard's story. The manual review still runs — preflight just removes the lint/validate/inspect chase from it.

---

## Lint + Validate + Snapshot

Lint + validate already ran inside the preflight orchestrator above. Read `<project-dir>/finalize_brief.json` — `gates.lint.output_tail` and `gates.validate.output_tail` carry the last 60 lines of each gate's combined stdout+stderr; `gates.lint.errors / warnings / info` carry the parsed counts. If preflight exited 0, both gates passed.

What this step still owns: **snapshots scaled to the video length** (formula: `max(beats × 3, ceil(duration_seconds / 2))`) and the per-beat read-and-verdict process below. Snapshots are not run by preflight — they're the input to the manual visual review.

**Errors:** Fix ALL of them. These are real problems — missing timeline registration, broken scripts, missing assets.

**Warnings:** Read each one and decide. Some are real quality issues you must fix:

- **GSAP tween overlaps** — elements fighting over the same property = visual glitches
- **Unscoped selectors** — will target elements in ALL compositions when bundled, causing data loss
- **Missing `class="clip"`** — element visible for entire video instead of its scheduled time
- **Missing `data-start` on root** — playback won't begin

Some are style suggestions you can safely ignore:

- **File too large** — composition works fine, just harder to read
- **Deprecated attributes** (data-layer, data-end) — still work, just not preferred
- **Dense tracks** — informational, not a bug

Don't blindly ignore 158 warnings. Don't blindly fix all of them either. Read them.

## Visual Verification (snapshot)

After lint and validate pass, capture snapshot frames to SEE your own output. **Take many snapshots — as much as you can actually read and view all of them without hitting diminishing returns**. This is your only visual feedback before the user sees the project. You wanna be honored and proud of what you give to the user.

Scale snapshot count to the video — not a fixed number. Formula: `max(beats × 3, ceil(duration_seconds / 2))`. A 3-beat 10s video: max(9, 5) = 9 frames. An 8-beat 60s video: max(24, 30) = 30 frames. Aim for at least 3 frames per beat: entrance, hold, and near-exit.

**⚠ NEVER use `npx hyperframes snapshot` (or any other `npx hyperframes` command).** The published package may be weeks behind the worktree and is missing critical fixes: snapshot sub-comp loading, local-time seek for last beats, Gemini vision descriptions, capture content-addressable filenames, perception gate. Always use the local CLI form (`npx tsx packages/cli/src/cli.ts ...`) below.

```bash
# The local CLI auto-loads .env from the current working directory, so a
# .env file in <project-dir> with GEMINI_API_KEY=... is enough — no explicit
# export needed. If you've set GEMINI_API_KEY directly in your shell env that
# also works.
npx tsx packages/cli/src/cli.ts snapshot <project-dir> --frames <N>

# Pass a custom question to Gemini instead of the default prompt:
npx tsx packages/cli/src/cli.ts snapshot <project-dir> --frames <N> \
  --describe "Is the brand logo visible in every beat? Is any beat showing a black or blank frame?"
```

Output lands in `<project-dir>/snapshots/`. Gemini writes `snapshots/descriptions.md` automatically.

**If `descriptions.md` is missing or empty after the snapshot:** `GEMINI_API_KEY` was not set — confirm it's in `<project-dir>/.env` (the CLI loads .env from CWD) or in your shell environment. Re-run after fixing. Do not proceed without Gemini descriptions — visual inspection alone is not sufficient verification.

**Gemini descriptions will flag two frames as "blank/black" — these two are expected and not bugs:**

- `frame-00-at-0.0s.png` — always dark, animations haven't started
- The last frame of the video — always dark, the s-end dummy scene is intentionally invisible

Every other frame described as "black," "blank," "no visible content," or "loading screen" in the middle of the video IS a bug. Investigate and fix it.

**Two required reads — both, not one. Then a per-beat verdict.**

1. **Read `snapshots/descriptions.md`** — Gemini's objective written analysis of every frame. Read every line. Do not skim.

2. **View `snapshots/contact-sheet.jpg` cell-by-cell.** Not a glance. Look at every cell, name what's in it. Past agents have reported "contact sheet looks good" after a single scan and missed: a beat that was visually black for 80% of its duration, a logo placed off-screen, a headline clipped at the canvas edge, captions running off the bottom. The contact sheet is the only place these failures are visible together. **For each cell, write one sentence: what's in frame, what's moving, which brand assets are present, anything that looks wrong.** If you find yourself wanting to summarize the contact sheet as a whole, stop and go back to cell-by-cell.

After reading both, write a per-beat verdict for every beat:

```
Beat 1 (0.0s–4.5s): [what Gemini described] | [what contact sheet shows] | PASS / NEEDS FIX
Beat 2 (4.0s–9.5s): ...
Beat 3 ...
CTA beat: ...
```

A beat PASSES only if:

- Gemini description matches what STORYBOARD.md says should be happening
- Contact sheet shows visible content (not black, not blank, not loading)
- Brand colors/fonts visible
- No elements clipped or mispositioned

A beat that "has some content" does not automatically pass. Compare against what was _planned_, not just "something is there."

**If any beat fails: fix it, re-snapshot, re-read descriptions.md, re-write the per-beat verdict from scratch.** Do not carry forward old verdicts after a fix — re-evaluate everything because fixes can break adjacent beats.

**Keep iterating until every beat passes.** There is no time limit. A video with one black CTA beat is not done.

## Mandatory Visual Inspection Checklist (per snapshot, 5 categories)

The verdict above tells you whether each beat matches its storyboard. **This checklist is a deliberate spotting protocol for the failure modes the storyboard match-up doesn't surface.** The eye is fragile (rate-limit prone, end-of-pipeline, subjective), so a structured pass over five concrete failure categories matters more than freeform "does it look right."

For every snapshot, walk through these five questions in order. If `preflight-finalize.mjs` produced a clean `finalize_brief.json` (no perception violations), the failure modes below are the residual eye-only checks. If perception coverage was partial (`brief.perception.skipped === true` or `brief.perception.scenes_no_timeline > 0`), this checklist is your ONLY safety net for the uncovered beats — don't skip it.

| # | Category | What to look for | Machine signal that should have caught it | In-place fix direction |
|---|---|---|---|---|
| 1 | **Illegibility / low contrast** | Squint at the snapshot. Is any primary text or brand mark hard to read against its background? Watch especially for `<img src="*.svg">` wordmarks on dark cards — the perception check cannot introspect external SVG fills, only inline `<svg>`. Captured logos often ship in a single fill that breaks on the wrong surface. | `low-contrast-foreground` in `brief.perception.violations[]`. **Blind spot: external `<img>` SVGs** — eye-only | Swap to the surface-appropriate asset variant (capture libraries usually ship light + dark; check `capture/extracted/asset-descriptions.md` for a `<name>-light.svg` / `<name>-dark.svg` sibling). OR move the element to a contrasting surface token. Do not recolor third-party SVGs unless you own the paths. |
| 2 | **Out of bounds** | Is any primary text / button / card edge cut by the 1920×1080 canvas? Cut by a parent container's `overflow:hidden`? Pinch-clipped by a parent `border-radius`? | `primary-offscreen` / `text-clipping` in `brief.perception.violations[]` | For zoom-induced clip: re-derive the camera counter-translate from the target's real `getBoundingClientRect()` center after `await document.fonts.ready` — do not hand-derive. For overflow clip: increase parent container height/width OR shrink child. For radius pinch: add `padding` to parent equal to the radius. |
| 3 | **Competing primaries** | Are there two equally-loud elements fighting for the same center safe zone? Two headlines stacked tightly? Two captured logos side-by-side at equal scale? A depth-stack spilling into a neighbor's text bbox? | `primary-collision` (annotated) / `cross-text-collision` (unannotated) in `brief.perception.violations[]` | Demote one to supporting (smaller size, lower contrast/opacity 0.6, less motion, off the primary bbox). Stagger their visible windows in the timeline so they don't share a frame. For depth-stack spill: add `position: relative; height: <px>; overflow: visible` to the depth-stack wrapper so back layers stay contained. |
| 4 | **Cramped / pressed-to-frame** | Are the children of a card/panel/stage container pressed against the container's top OR bottom border with no breathing room? Does the card look "stuffed"? Has a logo / wordmark / sign-off been crushed against the bottom edge of its parent? | `content-cramped-container` in `brief.perception.violations[]` | Root cause is usually an over-aggressive height shrink. **Preferred fix: restore the original `height:` / `top:`**, then re-run perception to confirm the original was actually fine. Only if restore re-fires the cramped check, reduce a child's intrinsic size (padding/gap/one font tier) or drop a non-essential child (tertiary sign-off mark). |
| 5 | **Seam jank / transition cracks** | At each shader-transition seam (`group_spec.shader_transitions[i].time` midpoint), inspect: does the cross-track blend cleanly? Any harsh black flash, color clash, or outgoing-beat exit animation fighting the transition? Outgoing beat should HOLD its final frame, not animate out. | None (transitions are deterministic; this is eye-only) | If the OUTGOING beat wrote its own exit animation that conflicts with the transition → that's a beat source bug (violates `beat-builder-guide.md`'s "no per-beat exit tweens" rule); `Edit` to remove the exit tween. If the transition TYPE itself is wrong (color clash needs blur instead of `flash-through-white`) → STOP and report so the orchestrator can re-author the storyboard's shader_transitions and re-prep. **Do not** hand-edit `index.html` — the assembler owns it. |

**Verification loop:** when you spot any of categories 1–4, the perception check should normally have caught it. Cross-reference `brief.perception.violations[]` (or `perception_report.json`). If it didn't, that's a coverage gap worth noting alongside your per-beat verdict (e.g. "low-contrast missed external `<img src="logo-dark.svg">` on beat-3 over `#1a1a2e` card — eye-caught"). Future-you will appreciate the breadcrumb when extending the perception script.

**Re-application sanity rule:** before applying any preflight-supplied `edit_old → edit_new` from `brief.caption_keepout` or `brief.perception` that shrinks `height:` on an element with `transform: translate*(...)`, hand-compute the visual bottom edge first. The static calculator handles `translate / translateY / translate3d` with px / % literals correctly — but if you see a violation whose container looks fine to your eye AND the rule has a `transform: ...`, the violation might be on a sibling element. Open the file and verify the selector matches what you think it matches before Editing.

## Critic Sub-Agent — do not skip

**This is not optional. Run it after your per-beat verdicts all pass — before you start preview.**

Spawn a sub-agent with this exact prompt:

```
You are a senior motion designer and creative director reviewing a brand video before it ships. You have high standards and have seen hundreds of these.

Read these files:
- STORYBOARD.md (what was planned)
- DESIGN.md (brand rules)
- snapshots/descriptions.md (what Gemini sees in each frame)
- snapshots/contact-sheet.jpg (view it)

Score each dimension 1–5. Be specific — name the beat and timestamp for every problem you identify.

1. **Beat execution** (1–5): Does every beat deliver what STORYBOARD.md planned? Name any beat that underdelivers and what exactly is wrong.
2. **Brand accuracy** (1–5): Does this feel made for THIS brand specifically, or could it be for any company? Name one element that is distinctly on-brand and one that is generic.
3. **Captured asset utilization** (1–5): The user captured the brand's actual SVG logos, hero illustrations, and screenshots into `capture/assets/`. Are they on screen in this video, or did the agents recreate everything from divs and CSS? List which captured assets appear in which beats. If beats are missing them, flag it — a video that recreates everything in CSS is generic, not branded.
4. **Visual quality** (1–5): Any blank frames, clipped text, centering failures, invisible elements? Cite exact frame timestamps.
5. **Motion design** (1–5): Do animations feel intentional and polished, or default and mechanical? Name the weakest transition and why.
6. **CTA beat** (1–5): Is the final beat clear, centered, readable, and does it hold long enough? Describe exactly what is visible on the CTA frame.

End with: What is the single most important fix before this ships? Name the beat, the element, and the specific change.

If you cannot find any problems and want to score everything 4–5, you are not looking hard enough. Look again.
```

Read every score. Fix anything below 3 before showing the user. If the CTA scores below 3, fix the CTA. Do not rationalize low scores as "the user can decide."

## Pre-render perception gate (deterministic, Puppeteer-driven)

Before kicking off the final render, run `scripts/check-rendered-perception.mjs` to catch the 8 visual-failure classes that survive lint + validate but ship broken (text-clipping, depth-layer ghosts on long words, primary-collision, cross-text-collision, primary-offscreen, content-cramped-container, low-contrast-foreground, font-too-small).

The script loads each beat in headless Chrome at 1920×1080, injects brand `@font-face` rules from `group_spec.font_face_css`, seeks the registered GSAP timeline at 3 probe points (40%/70%/92% of `estimatedDuration_s`), and emits a violation report with edit-ready `edit_old`/`edit_new` strings for the auto-fixable cases (horizontal text-clipping).

**Prerequisite:** `group_spec.json` exists. If not, run prep first (`node scripts/w2h-prep.mjs --hyperframes .`) — w2h-prep v3 aggregates `font_face_css` from every beat's `@font-face` blocks, dedupes by family+weight, and emits it as a top-level string for the probe to inject.

```bash
node skills/website-to-hyperframes/scripts/check-rendered-perception.mjs \
  --hyperframes . \
  --group-spec ./group_spec.json \
  --out ./perception_report.json
```

The script **always exits 0** — it's an informational gate, not a blocker. The output is `./perception_report.json`. Read it:

```bash
node -e "const r=require('./perception_report.json'); console.log('violations:', r.violations_count, '/ scenes scanned:', r.scenes_scanned, '/ skipped:', r.scenes_skipped); for (const v of r.violations) console.log('  -', v.type, '[', v.scene_id, ']', v.selector, v.metric ? JSON.stringify(v.metric) : '');"
```

For each violation:
- `type` — one of 8 classes above.
- `selector` — the failing element, e.g. `.b2-title`. (If you see bare `div`/`span` selectors with no class, the worker forgot to use the `b<N>-<slug>` class-prefix convention — perception can still report the issue but `edit_old` won't anchor uniquely.)
- `fix_kind` — `"edit-ready"` (has `edit_old`/`edit_new`/`edit_old_is_unique` you can apply directly) or `"manual"` (the brief explains; you make the call).
- `principle` + `suggestion` — terse rationale + one-line fix recommendation.

**Triage rule:** every `edit-ready` violation should be auto-applied via Edit; every `manual` violation should be reviewed and either fixed or explicitly accepted (e.g. intentional bleed → add `data-layout-bleed="true"` to the element).

**Skip modes (acceptable — scene not gated):**
- Scene has no `<template>` wrapper → no probe; warn the worker. (Per current Step 5, every beat MUST wrap in `<template>`.)
- Scene's GSAP timeline doesn't register on `window.__timelines["<sid>"]` within 5s → probe only runs at t=0. Counts as `scenes_no_timeline`. Usually means the worker forgot the `window.__timelines["<id>"] = tl` synchronous registration.
- Puppeteer/Chrome not available → entire report emits `{skipped: true, reason: "no chrome"}`. The gate is opt-in; missing puppeteer is not a fail.

**Annotation primer:** the gate respects 5 opt-in annotations workers can author on beats — `data-layout-role="primary"`, `data-layout-act="<name>"`, `data-layout-allow-overflow="true"`, `data-layout-bleed="true"`, `aria-hidden="true"`. Without them, primary-collision (Check 3a) and primary-offscreen (Check 4) vacuously pass; intentional camera-zoom scenes false-fire text-clipping. See [beat-builder-guide.md](./beat-builder-guide.md#layout-annotations--opt-in-markers-for-the-perception-gate) for the full rules + examples.

## Post-render verification (deterministic)

After the render completes, run the deterministic gate to catch the silent-failure classes that ate 7 of 12 multi-URL runs (zero-byte renders, header-only mp4s, duration drift, agents claiming "audio verified" without listening). The script is `scripts/verify-output.mjs`, ported from plv2 and standalone (Node builtins + `ffprobe` on PATH; no new npm deps).

**Prerequisite:** `group_spec.json` exists at project root. If it doesn't, run prep first:

```bash
node skills/website-to-hyperframes/scripts/w2h-prep.mjs --hyperframes .
# → writes group_spec.json with total_duration_s, scenes[], sfx[], canvas, captions_enabled
```

**Render gate** (catches missing file / undersized header-only renders / duration drift):

```bash
node skills/website-to-hyperframes/scripts/verify-output.mjs render \
  --hyperframes . \
  --group-spec ./group_spec.json
```

- Exit 0 + `✓ verify-render: renders/video.mp4 (<size>MB / <duration>s, drift <Δ>s)` → proceed.
- Exit 1 + `✗ verify-render.mjs: <reason>` → render failed. Common reasons: file missing, size <10KB (header-only), ffprobe failure, drift >0.5s vs `group_spec.total_duration_s`. Drift usually means a scene clip has wrong `data-duration`, or a sub-comp failed to mount (static-frame fallback runs full length).

**SFX gate** (audits `<audio>` cues in `index.html` against `group_spec.sfx[]` — no-ops cleanly when `sfx[]` is empty):

```bash
node skills/website-to-hyperframes/scripts/verify-output.mjs sfx \
  --group-spec ./group_spec.json \
  --index ./index.html
```

- ±0.1s drift tolerance per cue (3 frames @ 30fps).
- ±0.001s duration tolerance (decay tail belongs in the next clip, not truncated).
- Empty `sfx[]` → `✓ sfx-verify: 0 SFX cues in group_spec — nothing to check` (current w2h state; SFX cues will land in `group_spec.sfx[]` in a later port).

### Audio measurement — measure SOURCE files, never render to verify

**Do NOT render to check audio.** Render is a user-triggered final action, not a verification primitive. Measure source files directly: `narration.wav` (from Step 4 TTS) and individual SFX files in `sfx/`. The mp4 mixdown happens only when the user explicitly asks for `render`.

```bash
# Narration source file (skip if Step 2 picked option c / no narration)
ffmpeg -i narration.wav -af volumedetect -f null - 2>&1 | grep -E "(mean_volume|max_volume)"

# Each SFX source file (one ffmpeg call per cue)
for f in sfx/*.{wav,mp3}; do
  ffmpeg -i "$f" -af volumedetect -f null - 2>&1 | grep -E "(mean_volume|max_volume)" | head -1
done
```

Expected for VO source: `mean_volume ≥ -40 dB` and `max_volume ≥ -3 dB`. A mean below `-60 dB` is silence (TTS failed — re-run Step 4).

**SFX landing position:** verified by `verify-output.mjs sfx` parsing `<audio>` tag timing against `group_spec.sfx[]` — no render needed. Cue mismatch / drift shows up there.

**Forbidden phrasing** in your deliverable: "audio verified", "playback confirmed", "sounds great". Use only the ffmpeg numbers on source files: *"narration.wav mean -28.4 dB / max -2.1 dB; 3 sfx clips all mean ≥ -32 dB; verify-output.mjs sfx → 0 drift."*

## Interpreting `hyperframes lint` + `hyperframes validate` output — known false positives

Several lint/validate codes emit false positives or fix-hints that break renders if followed. Do NOT chase these — the deterministic gate above (`verify-output.mjs render`) is the source of truth for ship-readiness:

- **`font_family_without_font_face` on `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, `Menlo`, `Consolas`, `Monaco`** — fixed; these are now whitelisted as system fallback families. If your version still flags them, the lint rule needs updating.
- **WCAG contrast failures on elements with `opacity: 0` or `display: none`** — the linter shouldn't grade hidden elements. Verify the element is actually visible in a snapshot frame before responding.
- **`composition_self_attribute_selector` (97 warnings in cell-A raycast)** — the suggested fix breaks rendering. Leave the existing CSS alone; this rule's "fix hint" is wrong.
- **`inaccessible_script_url` on the GSAP CDN** — the engine REQUIRES the bare CDN URL with no SRI. The tag must look exactly like `<script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>`. Do NOT add `integrity=` or `crossorigin=`. Note: workers no longer emit this tag themselves — the assembler owns root `<head>` and emits it. See [step-5-build.md landmine #1 (sub-comp contract)](./step-5-build.md#1-sub-comp-contract-template-wrap--data-duration-on-root-hard-fatal-if-drift) for the rule and [beat-builder-guide.md DONE-criterion grep #7](./beat-builder-guide.md) for the self-check.
- **`gsap_repeat_ceil_overshoot` / `gsap_infinite_repeat` on drifters** — only `floor(T/cycle) - 1` as a literal integer passes. The pattern doc has stale examples.
- **Timeline-coverage FAIL on a single long `fromTo` at position 0** — the coverage check reads tween START position, not duration. A beat with one tween at `t=0, duration=5.5` (covering the whole beat) gets falsely FAILed because the check only sees one start-event. Cell-A huly + cell-G huly + multi-URL deep-verify hit this. Confirm coverage by reading the actual MP4, not the linter verdict.
- **SFX-coverage FAIL when SFX live in `<audio id="sfx-*">` tags but not in storyboard prose** — the SFX parser scans storyboard prose only; `<audio>` elements wired directly into index.html are invisible to it. Add the SFX cue to STORYBOARD.md as prose ("riser at 11.5s landing on the headline flash") and the FAIL clears. Cell-G huly + cell-H run-3 hit this.
- **`shader_declared_but_unused` triggered by anti-pattern prose** — DESIGN.md or STORYBOARD.md naming forbidden shaders ("flash-through-white", "glitch", "light-leak") in an anti-pattern section trips the shader-declared check via keyword match. Do NOT scrub your anti-pattern prose to please the regex — quote shader names with backticks/code-spans (`` `light-leak` ``) or rephrase the anti-pattern ("warm-light sweep is too on-the-nose") so the regex does not match.
- **Headline-floor FAIL on image-hero beats** — the 80px floor is a TEXT-only rule. Beats where the hero is a 520px logo image with no headline text get falsely FAILed; if you inflate a label to satisfy the gate you typically introduce a wider crossfade-zoom collision. Confirm visually: if the hero is an image, override the lint verdict and document the override in your beat's verdict.

If a check passes that you think might be vacuous (timeline coverage on a monolithic composition, brand-visuals on a sub-comp without storyboard cross-ref), don't trust the PASS — verify by taking a `snapshot` at the relevant timestamp (`npx tsx packages/cli/src/cli.ts snapshot . --frames N`) and reading the snapshot PNG. **Never render an MP4 just to verify.**

## Preview (always do this)

Always start the preview so the user can see and scrub through the project:

```bash
npx tsx packages/cli/src/cli.ts preview
```

The Studio URL is the deliverable. In your final response, always include it:

```text
http://localhost:<port>/#project/<project-name>
```

Use the actual port and project name from the preview command output. Do NOT present `index.html` as the project link — that's the source file. The user-facing project is the running Studio preview.

## Render (on-demand only) — NEVER render to verify

**Render is a user-triggered final action, not a verification primitive.** Do NOT render to spot-check a beat, measure audio, inspect a frame, or confirm a fix. Every other check happens via tools that do NOT produce an MP4:
- `lint` / `validate` / `inspect` — static checks (text output)
- `check-rendered-perception.mjs` — Puppeteer + GSAP seek (`perception_report.json`, no MP4)
- `snapshot` — seeked PNG frames + Gemini descriptions (no MP4)
- `ffmpeg volumedetect` on **source files** (`narration.wav`, `sfx/*.wav`) — no MP4

**Only render when the user explicitly asks** — "render it", "make the final", "export the MP4", "I'm happy, produce the file." Until then, the deliverable is the Studio preview URL.

Rendering takes minutes per pass and is wasted if the user wants changes. Preview is the delivery — the user scrubs, spots tweaks, and you iterate.

When rendering, **always specify quality and resolution explicitly.** Don't use defaults silently — pick the right settings for the use case and tell the user what you're rendering:

```bash
# Standard quality, 1080p landscape (default for most videos)
npx tsx packages/cli/src/cli.ts render --output renders/<name>.mp4 --quality standard --fps 30

# High quality for final delivery
npx tsx packages/cli/src/cli.ts render --output renders/<name>.mp4 --quality high --fps 30

# Portrait for Instagram Stories / TikTok
npx tsx packages/cli/src/cli.ts render --output renders/<name>.mp4 --quality standard --fps 30 --resolution portrait

# 4K for premium output
npx tsx packages/cli/src/cli.ts render --output renders/<name>.mp4 --quality high --fps 30 --resolution 4k
```

**Available options:**

| Flag              | Values                                                                                     | Notes                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `--quality`       | `draft`, `standard`, `high`                                                                | draft = fast/low, standard = balanced, high = slow/best                            |
| `--fps`           | `24`, `30`, `60`                                                                           | 30 is standard, 24 for cinematic feel, 60 for smooth motion                        |
| `--resolution`    | `landscape` (1920×1080), `portrait` (1080×1920), `landscape-4k` (3840×2160), `portrait-4k` | Aliases: `1080p`, `4k`, `uhd`                                                      |
| `--format`        | `mp4`, `webm`, `mov`, `png-sequence`                                                       | mp4 default. mov/webm for transparency. png-sequence for AE/Nuke                   |
| `--output`        | path                                                                                       | Always set to `renders/<project-name>.mp4` for readable names                      |
| `--gpu`           | flag                                                                                       | Use GPU encoding if available (faster)                                             |
| `--crf`           | integer                                                                                    | Override encoder quality (lower = better, mutually exclusive with --video-bitrate) |
| `--video-bitrate` | e.g. `10M`                                                                                 | Target bitrate (mutually exclusive with --crf)                                     |

Tell the user what you're rendering and why: "Rendering at standard quality, 1080p landscape, 30fps — this gives good quality with reasonable render time. Want me to use high quality or 4K instead?"
