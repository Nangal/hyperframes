# Step 5: Build Compositions

**Captions are NOT your job.** Do not author `compositions/captions.html`. The deterministic `scripts/captions.mjs` runs between this step and Step 6 (see Step 4's Captions section) and produces the captions composition with zero LLM calls. If you find yourself reaching for caption-related references in the hyperframes skill, stop — the script handles word grouping, skin selection, and brand tokenization. Build only the BEAT compositions here.

**Before building, verify you have:**

- **STORYBOARD.md** — the beat-by-beat plan. Re-read it now if you don't remember every beat's concept, assets, and techniques.
- **DESIGN.md** — if you need to check a specific value (color, font, component style) you can't recall, look it up. Don't re-read the whole file.
- **`capture/extracted/asset-descriptions.md`** — when the storyboard assigns an asset to a beat, check the description to understand what it shows. Re-read this file if you can't recall the asset inventory.
- **transcript.json** — word-level timestamps that drive scene durations.

Load the `hyperframes` skill — it has the rules for data attributes, timeline contracts, deterministic rendering, and layout. Read it now if you haven't already this session.

**For capabilities.md and techniques.md:** read the Table of Contents to orient yourself, then go deep only on the sections your storyboard actually calls for. You don't need to re-read sections for animation engines, registry blocks, or techniques that none of your beats use.

---

## 1. Get SFX from the catalog

SFX come from HeyGen's free catalog via the `hyperframes sfx` CLI — see [`../../hyperframes/references/sound-effects.md`](../../hyperframes/references/sound-effects.md). For each SFX the storyboard (Step 3) assigned, search by its description and download it into the project:

```bash
hyperframes sfx list                                    # the families, to orient (optional)
hyperframes sfx search "punchy transition whoosh" --json
hyperframes sfx add <id>                                # → assets/sfx/<id>.mp3, prints loudness/peak/onset/tail
```

`sfx add` writes the clip to `assets/sfx/` and prints its analysis (peak time, onset/tail, loudness) — use it to trim and anchor per the global doc. If `HEYGEN_API_KEY` isn't set, `sfx` prints how to get a free key; ask the user for one or build without SFX — don't silently drop them.

**Background music** (optional, storyboard-driven). If `STORYBOARD.md`'s Global Direction names a music bed, search and download it the same way with `hyperframes music search` / `music add` — output lands in `assets/music/<id>.<ext>`. Volume hierarchy is different from SFX (BGM `0.4–0.6` under VO; `0.7–0.9` pure-music) and there's no auto-ducking; see [`background-music.md`](background-music.md) for when music helps vs hurts, manual ducking patterns, and the one-bed-per-video rule.

## Known landmines — read before writing each beat composition

The rules below came out of cell-A through cell-H website-capture builds across heygen.com, raycast.com, huly.io, and airbnb.com in 2026-04 → 2026-05. Beat compositions that lint clean still ship broken without these — text that mask-reveals to nothing, sub-agents that silently overwrite each other's HTML. The linter cannot catch most of these; the author must.

Each rule names a single failure mode and the one-line fix. Do not summarize or shorten these when prompting sub-agents — paste them verbatim into the RULES section of every dispatch.

The root `index.html` is NOT in scope here — it's produced deterministically by `scripts/assemble-index.mjs` from `group_spec.json` (see Section 4 below — final action of Step 5). Workers only write `compositions/<beat-id>.html`. Old landmines about root template-wrapping, `data-composition-id` on `<html>`/`<body>`, and the GSAP script tag are now assembler-owned invariants — they cannot fire from a beat file.

### 1. Sub-comp contract: `<template>` wrap + `data-duration` on root (hard-fatal if drift)

Every beat composition lives inside `<template id="<beat-id>-template">…</template>` and the inside-template root `<div>` carries `data-composition-id="<beat-id>"` AND `data-duration="<X>"` where `X` matches `estimatedDuration_s` from the storyboard within `DUR_EPSILON=0.01s`. The assembler cross-checks this and **exits 1 on mismatch** — fix is upstream (re-dispatch the worker), never in the assembled index.html.

```html
<!-- ✅ GOOD: beat composition shape -->
<template id="beat-3-feature-tour-template">
  <div
    id="beat-3-feature-tour"
    data-composition-id="beat-3-feature-tour"
    data-width="1920"
    data-height="1080"
    data-duration="4.5"
  >
    <!-- beat content -->
  </div>
  <style>/* beat-scoped CSS */</style>
  <script>/* beat-scoped GSAP timeline registered as window.__timelines["beat-3-feature-tour"] */</script>
</template>
```


```html
<!-- ❌ BAD: data-duration on the host div in index.html (legacy cell-A pattern) -->
<!-- The assembler emits this host div; workers must NOT write it themselves. -->
<div data-composition-id="beat-3-feature-tour" data-duration="4.5" data-composition-src="..."></div>
```

Do NOT include `<script src="…gsap…">` or `<script src="hyper-shader-local.js">` inside your `<template>` — the assembler owns the root `<head>` and emits both. Duplicating them inside beats double-loads GSAP and double-inits HyperShader.

### 2. No opacity keys at t=0 (frame-0 black trap)

Any GSAP opacity tween whose start position is 0 — including `tl.fromTo(el,{opacity:1},{opacity:1},0)` and `tl.set(sel,{opacity:1},0)` — triggers GSAP's `immediateRender` under seeked rendering. Frame 0 renders pure black or white. The DOM initial state wins; the timeline's position-0 tween loses. Cell-F heygen burned 3 render cycles rediscovering this.

The fix lives in the DOM, not the timeline. Opening-scene entrances are TRANSFORM-ONLY. Put the subject's visible state in INLINE `style="opacity:1"` to override any CSS layer with `opacity:0`.

```js
// ❌ BAD: opacity tween starting at t=0 — frame 0 ships black
tl.fromTo(".hero", { opacity: 0 }, { opacity: 1, duration: 0.6 }, 0);
```

```html
<!-- ✅ GOOD: subject visible in DOM; scale-only entrance -->
<div class="hero" style="opacity:1">…</div>
<script>
  tl.fromTo(".hero", { scale: 0.92 }, { scale: 1, duration: 0.6, ease: "power2.out" }, 0);
</script>
```

If the scene container needs a fade-in, mark it `{noIn}` and use a transform on a child element instead.

### 3. Don't `yPercent` + `overflow:hidden` for mask-reveals

`.ln { overflow: hidden }` + child `<span>` initialized with `transform: translateY(108%)` + GSAP `fromTo({ yPercent: 108 }, { yPercent: 0 })` leaves text PERMANENTLY HIDDEN in the rendered MP4 and snapshots. Lint and validate both pass — the headline is just absent. Hit in cell-D run 1, run 2, and cell-F run 3.

Use plain opacity + y-pixel reveals instead:

```js
// ✅ GOOD
tl.fromTo(".headline", { opacity: 0, y: 60 }, { opacity: 1, y: 0, duration: 0.6 });
```

If you must use yPercent on a clipped child, mark the parent with `data-layout-allow-overflow` and use `line-height ≥ 1.35`.

### 4. Scope `d="..."` regex to `<path>` only

A broad normalizer like `/d="[^"]*"/g` over a composition file ALSO matches the substring inside `id="…"` (the `d` of `id`). It mangles `id="b8-cta"` → `id="b8 - c t a"` because `c`/`t`/`a` are SVG path command letters. CSS selectors break, `getElementById` returns `null`, you get a cascade of "GSAP target not found" warnings.

```js
// ❌ BAD: matches d="..." inside id="..."
htmlSrc.replace(/d="[^"]*"/g, normalizePath);

// ✅ GOOD: scoped to <path d="...">
htmlSrc.replace(/<path[^>]*\sd="([^"]*)"/g, normalizePath);
```

### 5. Drifter `repeat:-1` is a HARD lint error

Looping background "drifter" elements (floating particles, slow gradient orbs, ambient marks) often get authored as `repeat: -1` or `repeat: Math.ceil(T/cycle) - 1`. Both fail lint — `gsap_infinite_repeat` and `gsap_repeat_ceil_overshoot`. Only `floor(T/cycle) - 1` as a literal integer passes. The renderer's seek-based capture needs a finite, computable repeat count it can resolve at frame zero.

```js
// ❌ BAD
gsap.to(".drifter", { x: 100, duration: 2.6, repeat: -1 });
gsap.to(".drifter", { x: 100, duration: 2.6, repeat: Math.ceil(20 / 2.6) - 1 });

// ✅ GOOD: hardcode the integer
gsap.to(".drifter", { x: 100, duration: 2.6, repeat: 6 }); // floor(20/2.6) - 1
```

### 6. Don't use `class="scene"` for non-scene overlays in HyperShader compositions

`HyperShader.init()` pins every element with `class="scene"` to `opacity: 0` unless it's listed in `scenes[]`. An overlay with `class="scene"` will stay invisible forever. No lint or validate error. Use `position: absolute; z-index: 50` on a plain class like `.overlay-layer` instead.

### 7. Hero captions ≥ 80px, and don't combine `transform: scale` on parent with `top:50%; translate(-50%,-50%)` on child

Hero text floors at 80px (cell-H run-3 had a 52px caption fail). Separately: GSAP `scale()` on a wrapper makes the wrapper the containing block; `top:50%; transform: translate(-50%, -50%)` on an absolute child re-resolves against the collapsed wrapper and flies off-screen. For centering inside scaled wrappers, use flexbox on the camera wrapper and make the card a normal in-flow child.

### 8. Local fonts via literal family name, not CSS var

`font-family: var(--f)` where `--f: "Inter"` triggers `font_family_without_font_face` warning + "No deterministic font mapping for var(--f)". Chrome resolves the var at render but the compiler can't see through it. Captured `.woff2` files are often Next.js subsets and need explicit `@font-face`. Use the literal family name in `font-family` declarations — keep CSS vars for colors/sizes only.

```css
/* ❌ BAD */
:root { --f: "Inter"; }
body { font-family: var(--f), sans-serif; }

/* ✅ GOOD */
body { font-family: "Inter", system-ui, sans-serif; }
```

### 9. Always use the local CLI — never `npx hyperframes`

Every CLI invocation in this skill uses `npx tsx packages/cli/src/cli.ts <cmd>`. The published `npx hyperframes` is whatever shipped on npm; the local CLI is the current source. Lint rules, capture asset-naming, snapshot fixes, perception gate, assemble-index — all of them have unshipped changes that the published package doesn't have. Never run `npx hyperframes` for this workflow.

`lint` / `validate` take a DIRECTORY, not a file (`npx tsx packages/cli/src/cli.ts lint .` not `... lint index.html`). `--quality medium` is invalid — the valid set is `draft | standard | high`.

## 2. Build each composition — USE SUB-AGENTS

**Before dispatching, re-read DESIGN.md and STORYBOARD.md.** You wrote these files earlier in the session and you think you remember them. You don't — not the exact hex values, not the specific font families, not the button border-radius, not the Do's/Don'ts. Re-read them now so you can paste accurate brand rules and beat specs into each sub-agent prompt.

### Build the dispatch packet ONCE before fan-out

Workers do a single Read of a pre-built packet at Step 0 instead of pulling DESIGN.md + STORYBOARD.md + SCRIPT.md + transcript.json + brand values separately (saves 3-4 Reads × N workers). Run this once from `$PROJECT_DIR` before dispatching:

```bash
# Build shared header from project-level globals (DESIGN.md + STORYBOARD.md + SCRIPT.md + transcript.json)
bash <SKILL_DIR>/scripts/w2h-dispatch-packet.sh shared
# → writes /tmp/w2h-shared.txt
```

Then, for each beat you're about to dispatch, build the per-worker packet (shared header + that beat's spec inlined as YAML):

```bash
bash <SKILL_DIR>/scripts/w2h-dispatch-packet.sh beat 1 "compositions/beat-1-hook.html" "$(cat <<'YAML'
concept: kinetic-typography hook
mood: urgent
vo_cue: "Stop context-switching."
start_s: 0.0
duration_s: 1.8
techniques: [per-word-kinetic-type, scale-pop]
assets: []
text_effects: [soft-blur-in]
brand_values_paste: |
  primary: #3139FB
  font_display: "Aeonik"
  font_body: "Inter"
sfx: []
motion_floor: continuous-scale-drift
prev_beat_handoff: null
next_beat_handoff: composed-kanban
YAML
)"
# → writes /tmp/w2h-dispatch/b1.txt — the worker's one-Read input
```

In your sub-agent dispatch prompt, include the line `Dispatch packet: /tmp/w2h-dispatch/b<N>.txt` in the `## Dispatch context` block — the worker's INPUT contract (top of `beat-builder-guide.md`) tells it to Read that file at Step 0. **w2h workers may still read sibling beat files when continuity demands** (motif callbacks, color carry-through) — the packet is the default starting point, not a wall-off.

### Dispatch parallelism

**If your runtime supports parallel sub-agents** (Claude Code, Cursor, most agent frameworks): dispatch one sub-agent per beat — 3 to 4× faster than building sequentially. For 3+ beats, always dispatch in parallel. For 1–2 beats, sequential is fine.

**If your runtime does not support parallel sub-agents** (some Codex setups, serial-only models): build sequentially using the same context-packing template below. The template gives each build pass the same context a sub-agent would get — paste prev/this/next beat + brand values — so output quality is the same, just slower.

In either case, use the template. Do not skip it and build from memory.

Each sub-agent reads [beat-builder-guide.md](beat-builder-guide.md) — it has everything: rules, easing, file references, validation commands. **Do not try to paste all rules into the prompt yourself.** Instead, tell the sub-agent to read the guide file. You paste only the beat-specific context: the storyboard sections, brand values, and asset paths.

```
Build the composition for Beat N. Save to compositions/beat-N-<slug>.html.

FIRST: Read skills/website-to-hyperframes/references/beat-builder-guide.md end to end.
It has your full workflow, all rules, easing vocabulary, and file references.
Follow its workflow exactly:
  build → lint (`npx tsx packages/cli/src/cli.ts lint .`)
        → snapshot (`npx tsx packages/cli/src/cli.ts snapshot . --frames 3`)
        → view contact sheet AND read snapshots/descriptions.md
        → fix issues

After you finish, the main agent will READ your composition HTML top-to-bottom
and cross-check it against DESIGN.md and STORYBOARD.md — does the brand bg/accent
hex actually appear in your CSS, are the captured assets the storyboard called
for actually referenced, is the headline ≥80px, does the GSAP timeline cover
the full beat duration. Do the work honestly. Reports of "looks good" without
the work being done will be caught when the main agent opens the file.

═══ PREVIOUS BEAT (Beat N-1) ═══
[paste the FULL previous beat section from STORYBOARD.md]

═══ THIS BEAT (Beat N) ═══
[paste the FULL beat section from STORYBOARD.md — this IS the build spec]

═══ NEXT BEAT (Beat N+1) ═══
[paste the FULL next beat section from STORYBOARD.md]

═══ BRAND VALUES (from DESIGN.md) ═══
Colors:
  --bg:        #[hex]   primary background
  --fg:        #[hex]   primary text
  --accent:    #[hex]   CTA / highlights
  --surface:   #[hex]   card / panel backgrounds
  [add more if needed]

Fonts:
  Headlines: [font family], [weight]
  Body:      [font family], [weight]
  [paste the EXACT @font-face block from DESIGN.md Section 2 VERBATIM — every brand font the beat uses needs its @font-face declared in the beat's <style> block, src URL pointing at the hashed file in capture/assets/fonts/. Do not abbreviate, do not invent paths. Without the @font-face, the brand font won't load and Chrome falls back to the system stack.]

Key component styles:
  [paste relevant lines from DESIGN.md]

═══ CAPTURED ASSETS FOR THIS BEAT ═══
[Paste ACTUAL file paths + descriptions from asset-descriptions.md:

- capture/assets/hero-dashboard.png — full-bleed product dashboard, dark theme
- capture/assets/logo.svg — brand wordmark, white on transparent

Do NOT say "see asset-descriptions.md". Paste the paths here.]
```

The storyboard beat already contains everything — the concept, the visual choreography with exact timings, the CSS values, the SFX cues. The sub-agent's job is to translate that description into working HTML/CSS/GSAP, not to re-invent the creative direction. If you want, you can also paste any other relative and useful context to subagents if think it's good, why not.

### Per-composition process

For each beat:

**1. Read the storyboard beat.** The storyboard IS the build spec. It tells you what elements exist, how they enter, what they do during the beat, and how they exit. Follow it. If something in the storyboard isn't clear or seems impossible, research how to do it or ask — don't silently skip it.

**2. Build the static end-state first.** Position every element at its most visible moment. HTML+CSS only, no GSAP yet. The CSS position is the ground truth.

**3. Add the animation sequence.** Follow the storyboard's choreography — it specifies what happens and when. Use `tl.fromTo()` (not `tl.from()`) for entrances. Build the timeline in the order the storyboard describes.

**4. Add exit** (if CSS transition out). If shader transition — no exit animation needed.

**5. View the result.** After building, take a snapshot of this beat at different timestamps (where things are supposed to happen, animate, move and etc) and look at it from all angles, corners and positinos. Is the frame full and everything is exactly where it supposed to be? Are you sure??? Are elements readable? Does it match what the storyboard describes?

### Technical rules

- **No `repeat: -1`** — calculate exact repeats from beat duration
- **No `Math.random()`** — use a seeded PRNG
- **No bare `gsap.to()`** — all tweens on `tl`, never standalone
- **No full-screen dark linear gradients** — H.264 banding
- **Minimum fonts**: 80px+ headlines, 20px+ body
- **WCAG contrast on gradient backgrounds:** The contrast validator samples actual background pixels under the text element — if the background is a gradient image, darker parts of the image make the measured ratio _worse_ when you darken the text color, not better. Fix: either place text over a solid-color zone, or add `data-layout-ignore` attribute to decorative labels that don't need WCAG compliance. Don't blindly darken text color when the background isn't solid.

## 3. After all compositions are built — reconciliation check

Before moving to Step 6, run this sanity check:

```bash
# List every file in compositions/ and verify each one has a host div in index.html
ls compositions/
```

For every `.html` file in `compositions/`, confirm that `index.html` has a `data-composition-src="compositions/<filename>"` pointing to it. If any composition file is not referenced in `index.html`, add the missing host div now — an unreferenced composition is completely invisible at runtime.

Note: `compositions/captions.html` is NOT authored at this step. It is produced deterministically by `scripts/captions.mjs` (see Step 4 — Captions) after this step completes, and the assembler mounts it as track 12 if and only if the file exists. Do not create it here.

## 4. Deterministic index.html assembly — final action of Step 5

The root `index.html` is now produced deterministically by `scripts/assemble-index.mjs` — workers no longer hand-author it. The orchestrator runs prep then assembler:

```bash
node skills/website-to-hyperframes/scripts/w2h-prep.mjs --hyperframes <project-dir>
node skills/website-to-hyperframes/scripts/assemble-index.mjs \
  --group-spec <project-dir>/group_spec.json \
  --hyperframes <project-dir>
```

What `w2h-prep` emits in `group_spec.json` that the assembler reads:

- `total_duration_s`, `total_scenes` — derived from beat `data-duration` sum
- `composition: {width, height, fps}` — default 1920×1080×30; portrait/square supported by overriding before the assembler runs
- `voice: {path, start_s, duration_s, volume}` — auto-detected from `narration.wav` / `narration.mp3` at project root
- `font_face_css` — aggregated `@font-face` blocks from beats
- `groups[0].scenes[<sid>].{start_s, estimatedDuration_s, voicePath, wordsPath}` — per-beat
- `sfx[]` — empty by default; orchestrator extends from STORYBOARD.md SFX cues
- `shader_transitions: {bg_color, accent_color?, scenes[], transitions[]}` — NOT auto-emitted; the orchestrator adds this when the storyboard calls for HyperShader transitions (invariant: `scenes.length === transitions.length + 1`)

What the assembler writes:

- `index.html` — root composition at `{width}×{height}`, GSAP CDN tag (no SRI — engine contract), optional `<script src="hyper-shader-local.js">` when `shader_transitions` present, root `<div id="root" data-composition-id="main">` with host divs for scenes + audio tags
- Track lanes (enforced by the assembler, do not collide):
  - **0** — scene sub-comp host divs (one per beat)
  - **10** — global narration `<audio>` (default voice mode)
  - **11** — BGM `<audio>` (if `bgm_path` set)
  - **12** — captions sub-comp host (when `compositions/captions.html` exists from `captions.mjs html`)
  - **20+i** — SFX `<audio>` (one lane per cue, in `sfx[]` array order)
- `caption-overrides.json` empty `[]` shim (silences a validate `✗`)

Bootstrap script:

- Without `shader_transitions`: vanilla `window.__timelines["main"] = gsap.timeline({paused: true})` (workers add per-beat tweens via their own sub-comp registrations).
- With `shader_transitions`: `var tl = HyperShader.init({bgColor, accentColor, scenes, transitions})` + `window.__timelines["main"] = tl`. Scene host divs additionally carry `class="scene"` + inline `background-color: <bg_color>`.

Worker contract change (post-cutover):

- Workers write `compositions/beat-N-<slug>.html` with the root `<div data-composition-id="<sid>" data-duration="<X>">` carrying `data-duration` on the SUB-COMP ROOT itself (not the host div in index.html). The assembler's `DUR_EPSILON=0.01s` cross-check exits 1 on mismatch — fix is upstream (re-dispatch the worker), never in the assembled index.html.
- Workers do NOT include `<script src=".../gsap">` or `<script src="hyper-shader-local.js">` inside their `<template>`. The assembler owns root `<head>`; duplicating scripts in beats double-loads GSAP and double-inits HyperShader.

Hard-fatal conditions (assembler exits 1):

- `group_spec.json` missing or unreadable
- No scenes in `groups[].scene_ids`
- A scene file missing on disk (`compositions/<sid>.html`)
- Sub-comp root `data-duration` disagrees with `group_spec.estimatedDuration_s` beyond 0.01s
- `shader_transitions.scenes.length !== transitions.length + 1`

Once the assembler exits 0, move to Step 6 (Validate & Deliver). Step 6 owns the top-to-bottom read of every beat HTML against DESIGN.md / STORYBOARD.md — Step 5's previous "read everything" gate was duplicated work and has been folded into Step 6's per-beat verdict pass.
