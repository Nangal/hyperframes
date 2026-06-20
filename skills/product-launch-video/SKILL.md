---
name: product-launch-video-refactor
description: "turn a product or marketing URL, pasted script, or brief into a product launch video, including SaaS promos, feature reveals, app launches, company promos, and product marketing videos. Use this skill when the user wants to market, launch, promote, or reveal a product. Do not use it for general non-launch website tours, non-product topic explainers, GitHub pull requests, captioning existing footage, or short unnarrated motion graphics. If the intent is unclear, route through /hyperframes first."
---

# Product Launch to HyperFrames

Capture a product, understand its brand, plan a launch video, and build the video frame by frame in HyperFrames.

> **Confirm the route before Step 0.** You are the orchestrator. Run each step, verify its gate, and only then continue to the next step. This skill is for a **product being marketed, launched, promoted, or revealed**, including requests such as "promo for our site" when the purpose is promotional. Route other intents elsewhere: a general non-launch website tour -> `/website-to-video`; a topic explainer with no product -> `/faceless-explainer`; a GitHub PR -> `/pr-to-video`; captions on existing footage -> `/embedded-captions`; a short unnarrated motion graphic -> `/motion-graphics`. If the user says only "make a video" or the route is uncertain, read `/hyperframes` first.

Users may say things like:

- "Make a 60-second launch video for our SaaS at https://..."
- "Turn this script into a product promo, vertical for TikTok."
- "Feature reveal for X.com -- punchy, about 30 seconds."

All paths are relative to the project root `videos/<project>/`. The workflow has seven main steps, plus Step 3.1 for audio. Each step produces an artifact that gates the next step. User-gated steps require stopping to ask the user or obtain approval before continuing. You perform every step yourself except frame construction: Step 5 dispatches one sub-agent per frame. TTS, transcription, BGM, captions, transitions, and index assembly run through scripts. Do not add design or motion rules to this file; those rules live in the frame-worker sub-agent and in the `hyperframes-creative` and `hyperframes-animation` references it reads.

| #   | Step                               | Artifact                                       |
| --- | ---------------------------------- | ---------------------------------------------- |
| 0   | Setup and brief (user-gated)       | `hyperframes.json`                             |
| 1   | Capture assets                     | `capture/`                                     |
| 2   | Design system                      | `frame.md`                                     |
| 3   | Storyboard and script (user-gated) | `STORYBOARD.md` + `SCRIPT.md`                  |
| 3.1 | Audio                              | `audio_meta.json`                              |
| 4   | Frame visual design                | enriched `STORYBOARD.md`                       |
| 5   | Build frames                       | `compositions/frames/NN-*.html` + `index.html` |
| 6   | Finalize                           | `renders/video.mp4`                            |

---

## Step 0: Setup and Brief

Define the video brief and initialize the HyperFrames project when needed.

Confirm the brief in **one** message, leading with a recommended default and skipping anything the user already specified:

- **Angle:** whole product, one feature, or a specific offer.
- **Length:** default to about 30-90 seconds; allow up to about 3 minutes.
- **Aspect ratio:** default to 16:9; use 9:16 for vertical social video when requested.
- **Language:** match the user unless they specify otherwise.

If the user's request already specifies these details, do not ask again.

Initialize only when `hyperframes.json` is absent. Name `<project>` in kebab-case from the brand or domain, such as `acme-promo`. Never use the workspace basename or a timestamp as the project name.

```bash
npx hyperframes init "videos/<project>" --non-interactive --skip-skills --example=blank
```

**Gate:** `hyperframes.json` exists, and the angle, length, aspect ratio, and language are locked.

---

## Step 1: Capture assets

Classify the input, run the matching path, then read the extracted data to understand the **brand** — what it does, who it's for, its voice and mood.

| Input                 | Path                                                                                                                                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit URL          | Capture it; narration comes from the site.                                                                                                                                                                                                |
| Pasted script / brief | Save verbatim to `user_script.txt`; **ask once** "use it verbatim or restructure?" → `VO_MODE`; resolve a capture target (URL in text → use it; named brand → `WebSearch`, confirm the URL in one line before crawling; else no capture). |

**Vision key (optional).** With `GEMINI_API_KEY` / `GOOGLE_API_KEY` (or OpenRouter) set, the crawl auto-captions every asset (and rasterized SVGs) into `asset-descriptions.md` for Step 3 to pick from; without one it falls back to DOM context. It runs automatically inside the CLI — not a review gate. Optionally suggest the user set one for better asset selection (~$0.001 per image; free key at ai.google.dev → add to `.env`).

```bash
npx hyperframes capture "<URL>" -o ./capture   # CLI crawl
```

**No capture** (script/brief only, no site to crawl) → write, by hand, the two files the later steps still read: `capture/extracted/tokens.json` (brand tokens — `{ title, description, colors: [], fonts: [] }`; empty colors/fonts tell Step 2 to color the preset from the brief) and `capture/extracted/visible-text.txt` (the full brief — Step 3's narration source). Steps 2–6 then run exactly as they would after a real capture.

**Gate:** `capture/extracted/tokens.json` and `capture/assets/` exist, and you can state the brand in one line. Otherwise stop and report; if `capture/BLOCKED.md` exists, follow it.

---

## Step 2: Design System

Adopt one shipped **frame preset** and overlay the brand tokens to produce `frame.md`, this video's design system.

**Read** the `hyperframes-creative` design spec — `[../hyperframes-creative/references/design-spec.md](../hyperframes-creative/references/design-spec.md)` — for the available presets and the `frame.md` format. Pick a preset, copy its `FRAME.md` to the project root as `frame.md`, and overlay the brand tokens (change only `colors:` and `typography:`; keep its structure, geometry, and components). Don't invent a bespoke system — cross-frame consistency and the build contract depend on a shipped preset.

No site captured, or the brief lacks brand info? Use the user's `design.md` if they have one; otherwise ask once for a logo, brand colors, font direction, or a visual reference before writing `frame.md`.

**Gate:** `frame.md` exists, derives from a named shipped preset, and carries the brand tokens overlaid onto it — not an invented design system.

---

## Step 3: Storyboard and Script

Create the narrative plan for the video.

Use the approved brief and captured brand material to write:

- `STORYBOARD.md` — the concept-first narrative skeleton
- `SCRIPT.md` — the final locked script, only when narration is required

Before writing, read:

- `references/story-design.md`
- `../hyperframes-core/references/storyboard-format.md`
- `../hyperframes-core/references/script-format.md`

Use `story-design.md` for the product-launch story method, including archetypes, hooks, persuasion logic, beats, `VO_MODE`, and `asset_candidates`.

Inspect `capture/` yourself and choose the `asset_candidates` for each visual frame. Do not ask the user to pick assets unless the captured material is missing or unusable.

Write the storyboard and script using the exact required fields from the format references.

After drafting, show the user a frame-by-frame summary. Iterate until the user approves the plan.

**Gate:** `STORYBOARD.md` exists, every visual frame has `asset_candidates`, `SCRIPT.md` exists when narration is required, and the user has approved the frame-by-frame plan.

---

## Step 3.1: Audio

Generate narration, word timings, and background music from the approved script while visual design proceeds.

Start the audio job after Step 3 approval. Run it in the background, then proceed to Step 4 while it works.

```bash
node <SKILL_DIR>/scripts/audio.mjs --script ./SCRIPT.md --storyboard ./STORYBOARD.md --hyperframes . --out ./audio_meta.json &
```

The audio script synthesizes locked narration, captures word timings, and retrieves a BGM track from HeyGen's music library based on the storyboard's `music:` mood. This uses the HeyGen Audio API for retrieval, not generation, and uses the same `~/.heygen` credential as TTS. For voice provider details, read `[../hyperframes-media/references/tts.md](../hyperframes-media/references/tts.md)`.

If there is no narration and no `SCRIPT.md`, skip voice generation. BGM may still run when the storyboard specifies a music mood.

**Gate:** the audio job has started, or the project is explicitly marked silent.

---

## Step 4: Frame Visual Design

Add the visual and motion design layer to the storyboard.

Edit `STORYBOARD.md` in place. Do not create a new storyboard file.

Use `frame.md` as the source of truth for color, typography, and overall visual style.

Before editing, read:

- `references/visual-design.md`
- `references/composition.md`
- `references/motion-language.md`
- `../hyperframes-animation/`

Use `visual-design.md` for the exact fields to add to each frame and for the required `## Video direction` block.

Use `composition.md` to decide layout, hierarchy, focal points, and visual roles.

Use `motion-language.md` and `../hyperframes-animation/` to choose valid motion effects and `blueprint` IDs. Do not invent effect names or blueprint IDs.

For each visual frame, add the required visual and motion fields, including:

- `effects`
- `focal` and/or `roles`

Also add one video-wide `## Video direction` block that defines the overall visual direction, motion style, pacing, and design rules for the full video.

Do not change the story, script, asset choices, `asset_candidates`, `transition_in`, or captured source material from Step 3. Do not write HTML in this step.

**Gate:** Every visual frame in `STORYBOARD.md` has `effects` plus `focal` and/or `roles`, and the `## Video direction` block exists.

---

## Step 5: Build Frames

Build each approved frame into an isolated HTML composition and assemble the playable HyperFrames index.

First, once the Step 3.1 audio job has finished, join audio into `STORYBOARD.md` before dispatching workers — so frames build against real voice durations (skip both passes when the project is silent):

```bash
node <SKILL_DIR>/scripts/audio.mjs sync-durations --audio-meta ./audio_meta.json --storyboard ./STORYBOARD.md
node <SKILL_DIR>/scripts/audio.mjs fetch-sfx --storyboard ./STORYBOARD.md --hyperframes .
```

Duration syncing is mechanical — real voice duration wins, silent frames keep their estimate; never hand-edit synced durations. `fetch-sfx` downloads each named SFX from the HeyGen Audio API.

**Read:** `[sub-agents/frame-worker.md](sub-agents/frame-worker.md)`. It contains the per-frame composition contract and cites the generic composition rules in `hyperframes-core`. Before the first dispatch, read `[../hyperframes-core/references/subagent-dispatch.md](../hyperframes-core/references/subagent-dispatch.md)` once.

Dispatch **one sub-agent per frame, in parallel**. If the harness caps parallelism below the number of frames, run workers in waves; still assign exactly one frame per worker.

Each worker's context must include:

- `PROJECT_DIR`.
- `frame_id`.
- Canvas size.
- `Captions: <enabled|disabled>`, plus the caption keep-out band when captions are enabled.
- `ANIM_DIR`, the absolute path to the shared `../hyperframes-animation/` skill, so cited effect and blueprint IDs can resolve to their recipe bodies.

Each worker reads:

- `frame.md` as the design truth.
- Its own `## Frame N` block from `STORYBOARD.md`.
- The recipe body for each cited effect or blueprint ID.

Each worker writes only one output: `compositions/frames/NN-*.html`.

Workers must never edit the shared `STORYBOARD.md`, because concurrent writes would race. As each worker returns, you, the orchestrator, mark that frame as `built`, then `animated`, in `STORYBOARD.md`.

Once audio timings exist, build captions in the background, then assemble the index:

```bash
node <SKILL_DIR>/scripts/captions.mjs build --storyboard ./STORYBOARD.md --audio-meta ./audio_meta.json --hyperframes . --out ./caption_groups.json &
node <SKILL_DIR>/scripts/assemble-index.mjs --storyboard ./STORYBOARD.md --hyperframes .
```

`captions: skipped (<reason>)` is a valid outcome. Continue without a captions track when captions are skipped.

**Gate:** every frame is marked `animated`, `index.html` is assembled, and captions are either built or explicitly skipped.

---

## Step 6: Finalize

Inject transitions, validate the assembled project, and render the final video.

Run the final commands. There is **no backstop** in this step: if any command fails, surface stderr and stop. The user decides the fix; do not silently self-heal this step.

```bash
node <SKILL_DIR>/scripts/transitions.mjs inject --storyboard ./STORYBOARD.md --hyperframes .
node <SKILL_DIR>/scripts/transitions.mjs verify --storyboard ./STORYBOARD.md --index ./index.html
npx hyperframes lint
npx hyperframes validate
npx hyperframes inspect
npx hyperframes snapshot --at <frame-midpoints>
npx hyperframes render --quality high --output renders/video.mp4
```

A gate that names a frame indicates a worker contract break. Re-dispatch that frame's worker from Step 5, then rerun the finalization commands.

Offer a live preview only after the render. Never auto-open a preview: a mid-run preview can show half-built frames and fail with the server. On request, run:

```bash
npx hyperframes preview
```

Report the real preview URL.

**Gate:** `lint` , `validate` and `inspect` pass, and `renders/video.mp4` exists. The final reply states the MP4 path, duration, and offers the preview.

---

## Quick Reference

**Formats:** landscape `1920x1080` by default; portrait `1080x1920`; square `1080x1080`. Set the format once in the storyboard frontmatter.

**Background scripts:** the workflow ships only these scripts under `scripts/`: `audio` for TTS, transcription, BGM, SFX, and duration syncing; `captions`; `transitions` for inject and verify; and `assemble-index`. Everything else is handled by the `hyperframes` CLI.

| Read                                                                                                         | When                                                     |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `[../hyperframes-creative/frame-presets/](../hyperframes-creative/frame-presets/)`                           | Step 2: choose and adopt a frame preset.                 |
| `[../hyperframes-creative/references/design-spec.md](../hyperframes-creative/references/design-spec.md)`     | Step 2: apply brand tokens correctly.                    |
| `[references/story-design.md](references/story-design.md)`                                                   | Step 3: plan the product-launch story.                   |
| `[../hyperframes-core/references/storyboard-format.md](../hyperframes-core/references/storyboard-format.md)` | Step 3: write `STORYBOARD.md`.                           |
| `[../hyperframes-core/references/script-format.md](../hyperframes-core/references/script-format.md)`         | Step 3: write `SCRIPT.md`.                               |
| `[../hyperframes-media/references/tts.md](../hyperframes-media/references/tts.md)`                           | Step 3.1: choose or understand TTS providers and voices. |
| `[references/visual-design.md](references/visual-design.md)`                                                 | Step 4: enrich the storyboard visually.                  |
| `[references/composition.md](references/composition.md)`                                                     | Step 4: judge composition.                               |
| `[references/motion-language.md](references/motion-language.md)`                                             | Step 4: judge motion language.                           |
| `[../hyperframes-animation/](../hyperframes-animation/)`                                                     | Step 4: cite effect and blueprint IDs.                   |
| `[sub-agents/frame-worker.md](sub-agents/frame-worker.md)`                                                   | Step 5: dispatch per-frame workers.                      |
| `[../hyperframes-core/references/subagent-dispatch.md](../hyperframes-core/references/subagent-dispatch.md)` | Step 5: dispatch sub-agents safely.                      |
