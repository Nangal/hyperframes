# sing-deck — design system

Ported from `sing.html` (hyperframes team @ Singapore — recent update). Light,
editorial, product-deck aesthetic. **This is brand truth, not layout.**

## Palette (light theme)
- `--paper` #ffffff (canvas / background — light, NOT dark)
- `--tile` #f5f6fa · `--tile-strong` #eef0f6 (cards / panels)
- `--ink` #0e0e14 (primary text)
- ink ramp: strong = ink@92%, body = ink@76%, muted = ink@54% (mix toward paper)
- hairline borders: ink@14% (`--hairline`), soft ink@7%

### Brand + gradient accents
- `--brand` #6c5cff (primary accent — links, kickers, bullets, arrows)
- gradient `--grad`: `linear-gradient(100deg, #3d9bff 0%, #3fd08a 34%, #ff6fc8 66%, #8a6cff 100%)`
  used for: highlighted words (`.hl` text-clip), big numbers, router-chip borders.
- beatblock accents (demo widgets): coral #cc785c, amber #e8a55a, teal #5db8a6

## Type
- Display: **Sora** (700/800) — titles, big numbers. letter-spacing −0.02 to −0.04em, line-height ~1.04.
- Body: **Inter** (300–600), line-height 1.5–1.6.
- Mono: **JetBrains Mono** (400/500) — kickers, tags, captions, chips. uppercase + letter-spacing 0.03–0.16em for kickers.
- Title sizes (deck scale): page titles clamp(34–64px); thanks title clamp(64–132px). Use the large end at 1920×1080.

## Components / motifs
- **kicker**: mono, uppercase, tracked, muted — small eyebrow above titles.
- **cards** (`.callout`, `.skill-card`, `.estep`, `.analysis`): tile bg, hairline border, radius 12px, soft shadow `0 6px 20px ink@5%`.
- **route chips**: mono pill, tile bg; the "router" chip has a gradient border (padding-box paper + border-box grad).
- **media frames** (`.demo-media`, `.proof`): radius 12px, hairline border, dark (#0e0e14) fill behind video, strong shadow `0 16px 50px ink@16%`.
- **bullets**: a `✳` (spike) glyph in brand color.
- corners: 8px (md) / 12px (lg). ease: `cubic-bezier(0.22,1,0.36,1)`.

## Motion (deck)
- Entrances: title + kicker rise/fade (`y`, `opacity`), then body, then media/cards stagger. Vary eases (power3.out, expo.out, power2.out).
- Highlighted words can wipe-in the gradient fill.
- Hold each slide; no exit anims except the final scene (transition handles exits).
- Background: keep paper solid (no full-screen gradients — banding); gradient only on text/borders/accents.

## Canvas
- 1920×1080 landscape (deck). Content max-width band centered with generous padding (mirror `.wrap`/`.herowrap` ~28–80px → scale up to ~120–160px padding at 1080p).
