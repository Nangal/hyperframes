// media-use · audio/infer-bgm-prompt.mjs
// Pure BGM-prompt inference, lifted verbatim from the workflows' audio.mjs so the mood
// logic lives in ONE place. No I/O — pass the parsed narrator_scripts object in.
// Used by bgm.mjs to derive a query/prompt for BOTH the heygen catalog (preferred) and
// the Lyria/MusicGen generators (fallback).

const CAPTION_TAG_RE = /<\/?(em|brand|emph|cta)\b[^>]*>/gi;
const stripCaptionTags = (s) => String(s).replace(CAPTION_TAG_RE, "");

export function inferBgmPrompt(narrator = {}, { userBgmPrompt } = {}) {
  if (userBgmPrompt) return userBgmPrompt;

  // BGM-inference corpus: concatenate every scene's narrative metadata so we can match
  // category keywords (SaaS / crypto / creative / fintech) and the narrative archetype.
  const parts = [narrator.project || "", narrator.narrativeArchetype || "", narrator.emotionalArc || ""];
  for (const s of narrator.scenes || []) {
    parts.push(s.sceneName || "");
    parts.push(stripCaptionTags(s.script || ""));
    if (s.narrativeIntent) {
      parts.push(s.narrativeIntent.narrativeRole || "");
      parts.push(s.narrativeIntent.keyMessage || "");
    }
  }
  const blob = parts.join(" ").toLowerCase();

  // --- Industry base ---
  let base, bpm;
  if (/\b(crypto|nft|web3|defi|token|blockchain|exchange|wallet|dao)\b/.test(blob)) {
    base = "atmospheric electronic, deep bass, futuristic synths, restrained percussion";
    bpm = 100;
  } else if (/\b(finance|fintech|bank|payment|invest|wealth|insurance|treasury)\b/.test(blob)) {
    base = "calm cinematic, soft strings, subtle piano, restrained percussion";
    bpm = 92;
  } else if (/\b(creative|agency|design|studio|art|brand|marketing|content)\b/.test(blob)) {
    base = "playful electronic, warm pads, light percussion";
    bpm = 115;
  } else {
    base = "uplifting corporate tech, bright modern piano with synth pads";
    bpm = 108;
  }

  // --- Archetype adjusts the arc shape ---
  const archetype = (narrator.narrativeArchetype || "").toLowerCase();
  const arc = (narrator.emotionalArc || "").toLowerCase();
  if (/\bpas\b|pain.agitate|pain.+solve/.test(archetype))
    return `${base}, starts with subtle tension then builds to resolution, BPM ${bpm}, transitions from MINOR to MAJOR`;
  if (/\bbab\b|before.after|future.pac|vision/.test(archetype))
    return `${base}, cinematic and aspirational, steady build with rising energy, BPM ${bpm}, MAJOR`;
  if (/cascade|feature.benefit/.test(archetype)) {
    bpm = Math.min(bpm + 10, 128);
    return `${base}, energetic and driving, consistent momentum without slowdown, BPM ${bpm}, MAJOR`;
  }
  if (/demo.loop|question.+answer/.test(archetype)) {
    bpm = Math.max(bpm - 8, 88);
    return `${base}, clean and focused, minimal arrangement to not distract from UI demo, BPM ${bpm}`;
  }

  // --- Emotional arc as tiebreaker ---
  if (/frustrat|anxiety|overwhelm|tension/.test(arc) && /relief|excite|triumph/.test(arc))
    return `${base}, builds from understated tension to uplifting resolution, BPM ${bpm}, MINOR to MAJOR`;
  if (/excit|awe|power|triumph/.test(arc)) return `${base}, energetic and confident, uplifting throughout, BPM ${bpm}, MAJOR`;
  if (/trust|ease|clarity|reassur/.test(arc)) return `${base}, warm and reassuring, gentle momentum, BPM ${Math.max(bpm - 5, 85)}`;

  return `${base}, BPM ${bpm}, MAJOR`;
}
