# Sound Effects

Sound effects are searched from HeyGen's catalog by meaning, downloaded locally, and embedded as ordinary audio clips. What a sound _does_ depends on its shape in time — some punctuate a single frame, some build across a stretch, some run quietly under a whole scene — and the real craft is combining them: sequencing, layering, and chaining clips into something that feels designed rather than dropped in.

## The five things a sound can do

A clip's **duration tells you its job.** Don't treat them all as one-frame stingers.

| Mode      | What it needs                       | Examples                                                        | Typical len | How it's placed                         |
| --------- | ----------------------------------- | --------------------------------------------------------------- | ----------- | --------------------------------------- |
| **Hit**   | a beat (one frame)                  | whoosh, impact, pop, ui click, bell, glitch, notification, coin | 0.1–2s      | `data-start` = the exact event frame    |
| **Build** | a span _into_ a beat                | riser (ascends), downlifter (descends)                          | 3–12s       | so it resolves on the beat (see Timing) |
| **Bed**   | a scene + a mood — **not** an event | ambience, drone, wind, rain, sci-fi hum, crowd roar             | 8–20s       | runs _under_ the whole scene, very low  |
| **Sting** | a reveal / lock moment              | logo reveal, suspense sting, brand intro                        | 1.5–8s      | `data-start` = the reveal frame         |
| **Meme**  | a comedic beat                      | vine boom, record scratch, air horn, sad trombone, "sus", boing | 0.4–3s      | on the comedic moment — sparingly       |

The key thing: **not every sound is tied to an event.** A _bed_ needs a scene with a mood, not a beat — it's a texture you lay underneath. Hits, builds, stings, and memes are punctuation and _do_ land on beats.

## Two layers: a bed underneath, punctuation on top

Think of a clip's sound as (at most) two layers:

1. **A bed (optional, continuous).** If a scene has an _environment or mood_ worth establishing — an outdoor shot, a tense reveal, a futuristic UI, a stadium moment — lay **one** bed under it at very low volume. It isn't tied to any frame; it sets the floor and gets out of the way. Most plain talking-head / UGC clips don't need one; atmospheric ones come alive with one. Never stack two beds — they muddy each other.

2. **Punctuation (on beats).** On top of the bed — or with no bed at all — punctuate the real beats with hits, builds, stings, or the occasional meme.

## Punctuation follows beats, not motion

This rule governs the _punctuation_ layer (hits / builds / stings / memes), not beds.

A **beat** is a moment the viewer is meant to _register_ — the edit snaps, lands, or turns: a hard cut, a key element popping in, a number hitting, a build peaking, a CTA, a comedic turn. These earn a punctuation sound.

**Motion is not a beat.** A card drifting across the frame, a slow zoom, a parallax pan, a looping idle animation, decorative movement — these carry themselves visually. A whoosh on every one of them turns polish into noise. When unsure, ask: _would an editor cut, flash, or snap something here?_ If not, no hit.

The rule cuts both ways:

- **No beat left silent.** A reveal montage is a _series_ of beats — skipping SFX there entirely is a miss, not restraint.
- **No hit on mere motion.** Don't punctuate drifts, ambient loops, or decorative animation. If a scene needs _something_ under that motion, that's a job for a quiet bed, not a hit.

## Same beat, same sound (the motif rule)

Repeated beats of the **same kind share one sound.** Six cards entering one after another are six instances of _one_ beat → _one_ whoosh, reused: embed the same file in multiple `<audio>` tags with different `data-start` values. Giving each repeated beat a _different_ sound is the opposite mistake from skipping them — it reads as busy and amateur and pulls attention to the audio. Reserve a **new** sound only for a **new kind** of beat: the final logo lock, the CTA, the one big impact. Aim for breadth of **function**, not a pile of variants.

## Combining sounds

The catalog is a kit, not a jukebox — the interesting results come from putting clips _together_. You have four knobs (`data-start`, `data-duration`, `data-volume`, `data-media-start`) and the freedom to use one file many times. Experiment whenever you see an opportunity; the patterns below are starting points, not limits. (Pro sound design is exactly this — stacking and sequencing layers, not dropping single one-shots.)

- **Sequence — turn one hit into a rhythm.** A "ta-ta-ta-ta" burst is _one_ short impact reused: five `<audio>` tags pointing at the same file, `data-start`s on each rhythmic frame, and one of them louder (`data-volume`) to accent the downbeat. Use `data-media-start` to trim the attack so each repeat is tight.
- **Layer — stack clips at the same frame for weight.** Fire two or three clips at the _same_ `data-start` to thicken one moment: an impact + a sub-drop for a heavier hit, a whoosh + a click for a snappier transition. Keep the total under control with `data-volume` so the stack doesn't clip.
- **Chain — connect a build to its payoff.** A riser into an impact/bass-drop: the drop fires at the riser's **actual peak**, which is often _before_ the file ends (an 8s riser may peak at 6.0s). Set the drop's `data-start` to the real peak time, not `riser_start + file_duration`. They can even overlap — the tail of the riser under the head of the drop reads as one continuous gesture. (Use `sfx inspect` / the `add` output to find the peak — see below.)
- **Walk — fake motion from foley.** Two footstep variants alternated at a steady cadence (step every ~0.4–0.5s), each step's `data-volume` nudged slightly so it doesn't sound machine-stamped, makes a walk cycle. (The engine has no stereo pan, so cadence + level variation — not L/R placement — is what sells it.)

## Knowing what a clip does (you can't hear, but you can measure)

You can't listen to a clip, so don't _guess_ where a riser peaks or how loud one sound is next to another. **`sfx add` prints an analysis after download** (and `sfx inspect <id>` re-runs it on demand). Two things cover almost everything, with the clip's catalog `description` filling in _character_:

**1. Numbers — loudness and timing.** Integrated loudness (LUFS), true peak, **peak time** (loudest moment), and **onset / tail** (first/last audible moment):

- **peak time** → where to fire the next clip in a chain (the drop after a riser).
- **onset** → set `data-media-start` to skip dead air at the head of a slow-attack clip; **tail** → the clip's real end.
- **loudness (LUFS)** → set `data-volume` by _measured_ level, not vibes: a clip several LU louder than another should sit a notch lower to match.

**2. The shape — a loudness sparkline** (`shape ▁▂▅█▇▃▁`). This is the _energy contour over time_ — a build ramps up, a drop falls off a cliff, a break dips to silence mid-clip. It tells you how the **level** moves (which is what `data-volume` and chaining care about).

For _character_ — bright tick vs. dull thud, the feel of the sound — read the clip's `description` / `name` from the search result; that's what it's for, and it's already text.

### Reading the numbers correctly

All times in the analysis are **clip-relative** (0 = the clip's own start), _not_ positions on the composition timeline. Work in this order:

1. **Trim dead air first.** A catalog clip can carry silence padding — a "5s riser" may be 2s silence + 5s rise + 1s silence — and if you place the raw file it fires late and wastes its tail. Set `data-media-start = onset` and `data-duration = tail − onset` so only the real content plays. (`sfx add`/`inspect` print this as a ready `trim` line.) After trimming, the audible sound begins **exactly at `data-start`**.
2. **Anchor to the beat.** A **hit** (click, impact, whoosh) aligns by its attack — now at the start — so `data-start = beat`. A **build** (riser) aligns by its peak, which sits `peak − onset` into the trimmed clip, so `data-start = beat − (peak − onset)`. Example: a riser with onset 2.0s, peak 6.0s landing on a beat at 10.0s → `data-media-start="2.0"`, `data-start="6.0"` (= 10.0 − 4.0); fire the drop at 10.0s. They overlap — that's the chain.
3. **Level** — the catalog is loudness-normalized, so the volume hierarchy is your baseline; you usually don't touch it. Use measured LUFS only to _nudge_: if two layered clips clash, drop `data-volume` on the one with the higher (louder, less-negative) LUFS.
4. **Shape** — the sparkline spans the whole clip; block `i` sits at `t ≈ (i + 0.5) / length × duration`. Read it for _where_ the energy builds, drops, or breaks — then place your trigger there.

(There's no need to _cut_ the audio into a new file — `data-media-start` + `data-duration` trim at render time, losslessly and reversibly. Only mid-clip gaps, which a single window can't remove, would call for a different clip.)

## How many — count beats, not animations

A typical 15–30s social clip has roughly **3–7 real beats**, and motifs mean even fewer _distinct_ sounds. Beds are separate — about **one per scene**, not in that budget. If your hit count is climbing toward your _animation_ count, you're scoring motion: stop. Contrast is the real tool — a quiet stretch is what makes the next hit land. "Silence is a tool" means _let beats breathe_, not _prefer none_.

## Get a sound: search, add, embed

The catalog is semantic — search by what the sound _does_ and how it _feels_, not by a filename. But **don't reflexively search the same "whoosh" every time** — the catalog has ~180 clips across ~22 families (impacts, foley, whooshes, **memes**, stingers/logos, bells, UI, **ambiences**, **downlifters**, risers, glitches, …). Most agents never reach past the obvious. So **start by browsing the families**, then search within the right one.

```bash
# 0. See what's actually in the catalog — families, counts, examples (start here)
hyperframes sfx list
hyperframes sfx list --json   # for agents

# 1. Search by description (function + character), within the right family
hyperframes sfx search "whoosh for a scene change"
hyperframes sfx search "low tense ambience drone bed"   # a bed, not a hit
hyperframes sfx search "sad trombone fail meme" --json   # for agents

# 2. Download the chosen clip into the project (assets/sfx/) — prints an analysis
hyperframes sfx add <id>

# 3. (optional) Re-print the analysis for a clip you already have
hyperframes sfx inspect <id>
```

Search hits return `name`, `description`, `duration`, and `score`. Use the **duration to tell the mode apart** — a 0.5s result is a hit, a 10s result is a bed. Always `add` (download) and embed the **local file**; never embed the search result's `audio_url` (it's a presigned URL that expires before render):

```html
<audio src="assets/sfx/<id>.mp3" data-start="3.2" data-duration="1.5" data-volume="0.3"></audio>
```

### Access (free, but needs a key)

Sound effects come from HeyGen's **free** catalog, which needs a HeyGen API key (same credential chain as `tts` — `HEYGEN_API_KEY` or `hyperframes auth login`). `sfx list` and `sfx inspect` work offline; `sfx search` and `sfx add` need the key.

**If the key isn't set, don't silently skip SFX — ask the user**, the way VO asks for a voice key:

> "I can add sound effects from HeyGen's free catalog — it needs a HeyGen API key. Paste one here, or add `HEYGEN_API_KEY=your-key` to a `.env` file in the project root (get a free key at https://app.heygen.com/developers/api). Or say _skip_ and I'll build the video without SFX."

`sfx search`/`add` print this same guidance if the key is missing, so a missing key is a clear prompt, never a crash.

## Choosing the right one

Search with **function + character**, then read the returned `name`, `description`, and `score`:

- "whoosh for a scene change" surfaces transition whooshes; "deep cinematic impact" vs "soft ui tap" — character matters as much as type.
- Match **duration to the mode**: a short swipe for a quick cut (hit), a longer riser for a build, a long drone for a scene bed. Use the returned `duration` as the clip's `data-duration`.

## The audio contract (what the engine honors)

SFX are plain audio clips — no special engine handling. The mixer reads exactly:

- **`data-start`** — when the clip fires (seconds): the trigger frame (or the scene start, for a bed).
- **`data-duration`** — how long it plays; use the catalog duration. (`data-end` also works; duration is end minus start.)
- **`data-volume`** — 0 to 1. This is the **only** knob that sets level under voiceover. There is **no pan** — volume and timing are the only audio controls.
- **`data-media-start`** — trim into the source file (skip the first N seconds), for clips with a slow attack.

`data-track-index` does **not** affect audio mixing — every clip mixes together regardless of its index. It only organizes the visual timeline. So `data-volume`, not the track index, is what keeps SFX under the VO.

## Volume hierarchy

Layer levels so nothing fights the voice:

| Layer                | data-volume |
| -------------------- | ----------- |
| Narration / VO       | 1.0         |
| Background music     | 0.4 – 0.6   |
| Sound effects (hits) | 0.2 – 0.35  |
| Ambient bed          | 0.08 – 0.2  |

A bed sits at the very bottom — it should be _felt_, not heard. A whoosh at 1.0 over narration is jarring; at 0.3 it punctuates without masking the words. When two SFX should match in level, compare their measured LUFS (from `sfx add`/`inspect`) rather than assuming equal `data-volume` sounds equal.

## Timing wisdom

- **Hits peak at the start** — set `data-start` to the exact event frame.
- **Risers peak at the end of their _rise_, not their file** — fire the payoff at the measured peak time (from `inspect`), and set a riser's own `data-start` to (climax minus rise length) so the swell lands on the hit. **Downlifters** start _at_ the beat and fall away after it.
- **Beds span the scene** — `data-start` at the scene's first frame, `data-duration` to cover it; extend or repeat the clip to fill a long scene.
- **Sync to beats** — align punctuation to the same frames your motion lands on (see [beat-direction.md](beat-direction.md)). A whoosh on a cut, with the visual cut on the same frame, reads as one event.
- **Anticipation** — a few frames early often feels tighter than dead-on.

## Worked examples

**A reveal composition** — six cards enter from different angles, then the logo locks in:

- The six entrances are **one beat class** → one whoosh, reused (`sfx add` once, six `<audio>` tags at the same file, each `data-start` on that card's entrance frame, small `data-volume` variation). _Not_ six different whooshes.
- The logo lock is a **different beat** → one sting or impact on the lock frame.
- The drift and parallax between entrances → nothing. That's motion.
- Result: **two distinct sounds, seven hits** — deliberate, not a soundboard.

**A build into a drop** — a stat sweeps up, then slams onto screen:

- Add a riser and an impact. Run `sfx inspect` on the riser → say it peaks at 6.0s of its 8s file.
- Riser `data-start` so 6.0s-in lands on the slam frame; impact `data-start` on that same frame (overlap the riser's tail under it).
- Result: one continuous build-and-hit gesture from two clips.

**An atmospheric scene** — a tense product teaser over a dark background:

- Lay **one bed** (a low tension drone, ~10s) under the whole scene at `data-volume="0.12"`. No beat needed — it sets mood.
- Punctuate only the real beats on top: a riser into the product reveal, one impact on the reveal frame.
- Result: a continuous floor + two punctuation sounds.

## Constraints

- Embed the **local** downloaded file, never the presigned `audio_url` (it expires).
- One catalog clip is one file; re-use it across moments by adding multiple audio tags pointing at it with different `data-start` values — this is how the motif rule, a rhythmic sequence, and a repeated bed are all implemented.
- Deterministic like everything else — no runtime fetching at render; the file is on disk via `sfx add`.
