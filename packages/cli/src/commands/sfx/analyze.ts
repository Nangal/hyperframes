/**
 * Audio analysis for sound-effect clips.
 *
 * Agents can't *hear* a clip, so they can't guess where a riser peaks or how
 * loud one sound is next to another. This runs ffmpeg once over a local file
 * and extracts the few facts that drive placement decisions:
 *
 *   - integratedLufs / truePeakDb  → set `data-volume` by measured level
 *   - peakTimeSec                  → where to fire the payoff in a chain
 *   - onsetSec / tailStartSec      → trim dead air (`data-media-start`) / real end
 *
 * Everything comes from a single `ebur128 + silencedetect` pass (both filters
 * pass audio through and report to stderr), so there's no new dependency —
 * ffmpeg is already the local-render soft-dep. The parser is split out as a
 * pure function so it can be unit-tested without invoking ffmpeg.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findFFmpeg, getFFmpegInstallHint } from "../../browser/ffmpeg.js";

const execFileAsync = promisify(execFile);

export interface AudioAnalysis {
  /** Clip length in seconds (from the container), or null if unknown. */
  durationSec: number | null;
  /** EBU R128 integrated loudness in LUFS (perceived level), or null. */
  integratedLufs: number | null;
  /** True peak in dBFS (clipping headroom; 0 = full scale), or null. */
  truePeakDb: number | null;
  /** Time of the loudest moment (max momentary loudness) — a chain's resolve point. */
  peakTimeSec: number | null;
  /** First audible moment: end of any leading silence (0 if it starts hot). */
  onsetSec: number;
  /** Start of trailing silence — the clip's effective end — or null if it plays to the end. */
  tailStartSec: number | null;
  /**
   * Loudness contour over the clip — momentary LUFS sampled across time (silence
   * floored at -70), downsampled to at most ENVELOPE_BINS values. This is the
   * *shape* (build / drop / break), not just the peak: bin i is centered at
   * t ≈ (i + 0.5) / envelope.length × durationSec.
   */
  envelope: number[];
}

/** Max points in the returned envelope — bounded regardless of clip length. */
const ENVELOPE_BINS = 64;
/** Momentary LUFS below this counts as silence for the contour. */
const SILENCE_FLOOR_LUFS = -70;

export class FFmpegNotFoundError extends Error {
  readonly hint: string;
  constructor() {
    super("ffmpeg not found");
    this.name = "FFmpegNotFoundError";
    this.hint = getFFmpegInstallHint();
  }
}

/** Run ffmpeg's ebur128 + silencedetect over `filePath` and parse the result. */
export async function analyzeAudio(filePath: string): Promise<AudioAnalysis> {
  const ffmpeg = findFFmpeg();
  if (!ffmpeg) throw new FFmpegNotFoundError();

  const args = [
    "-hide_banner",
    "-nostats",
    "-i",
    filePath,
    "-af",
    "ebur128=peak=true,silencedetect=noise=-50dB:d=0.1",
    "-f",
    "null",
    "-",
  ];

  let stderr = "";
  try {
    const res = await execFileAsync(ffmpeg, args, { maxBuffer: 64 * 1024 * 1024 });
    stderr = res.stderr;
  } catch (err) {
    // ffmpeg can exit non-zero yet still emit the full analysis on stderr.
    stderr = (err as { stderr?: string })?.stderr ?? "";
    if (!stderr) throw err;
  }
  return parseFfmpegAnalysis(stderr);
}

/**
 * Pure parser for the stderr of `ffmpeg -af ebur128=peak=true,silencedetect=...`.
 * Exported for unit tests — no I/O.
 */
export function parseFfmpegAnalysis(stderr: string): AudioAnalysis {
  const lines = stderr.split(/\r?\n/);
  const durationSec = parseDuration(stderr);
  const { peakTimeSec, envelope } = parseMomentary(lines);
  return {
    durationSec,
    // Both the per-frame lines and the final summary print "I: ... LUFS"; the last
    // occurrence is the integrated value. "Peak:" only appears in the True-peak summary.
    integratedLufs: lastMatchedNumber(stderr, /\bI:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g),
    truePeakDb: lastMatchedNumber(stderr, /\bPeak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/g),
    peakTimeSec,
    ...parseSilence(lines, durationSec),
    envelope,
  };
}

/** "Duration: 00:00:08.01, ..." → seconds. */
function parseDuration(stderr: string): number | null {
  const dur = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (dur?.[1] && dur[2] && dur[3])
    return Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number.parseFloat(dur[3]);
  return null;
}

/** Last capture-group-1 match of `re` across the whole stderr, as a number. */
function lastMatchedNumber(stderr: string, re: RegExp): number | null {
  const last = [...stderr.matchAll(re)].at(-1);
  return last?.[1] ? Number.parseFloat(last[1]) : null;
}

/**
 * Momentary loudness over time → the loudest moment and the full contour.
 * ebur128 prints e.g. "t: 1.20  TARGET:-23 LUFS  M: -22.3 S: ... I: ... LRA: ...".
 */
function parseMomentary(lines: string[]): { peakTimeSec: number | null; envelope: number[] } {
  const mom: Array<{ t: number; m: number }> = [];
  const tRe = /\bt:\s*(-?\d+(?:\.\d+)?)\b.*?\bM:\s*(-?\d+(?:\.\d+)?)/;
  for (const ln of lines) {
    const m = ln.match(tRe);
    if (m?.[1] && m[2]) mom.push({ t: Number.parseFloat(m[1]), m: Number.parseFloat(m[2]) });
  }
  let peakTimeSec: number | null = null;
  let maxM = Number.NEGATIVE_INFINITY;
  for (const { t, m } of mom) {
    // M of about -120 means silence/-inf; ignore it when finding the peak.
    if (m > SILENCE_FLOOR_LUFS && m > maxM) {
      maxM = m;
      peakTimeSec = t;
    }
  }
  return { peakTimeSec, envelope: buildEnvelope(mom.map((p) => p.m)) };
}

/** Pair up silencedetect start/end lines into [start, end] intervals (trailing runs to EOF). */
function collectSilenceIntervals(
  lines: string[],
  durationSec: number | null,
): Array<[number, number]> {
  const intervals: Array<[number, number]> = [];
  let pendingStart: number | null = null;
  for (const ln of lines) {
    const s = ln.match(/silence_start:\s*(-?\d+(?:\.\d+)?)/);
    if (s?.[1]) {
      pendingStart = Number.parseFloat(s[1]);
      continue;
    }
    const e = ln.match(/silence_end:\s*(-?\d+(?:\.\d+)?)/);
    if (e?.[1] && pendingStart !== null) {
      intervals.push([pendingStart, Number.parseFloat(e[1])]);
      pendingStart = null;
    }
  }
  if (pendingStart !== null && durationSec !== null) intervals.push([pendingStart, durationSec]);
  return intervals;
}

/** Leading silence → onset; trailing silence (reaching EOF) → tail start. */
function parseSilence(
  lines: string[],
  durationSec: number | null,
): { onsetSec: number; tailStartSec: number | null } {
  let onsetSec = 0;
  let tailStartSec: number | null = null;
  for (const [start, end] of collectSilenceIntervals(lines, durationSec)) {
    if (start <= 0.05) onsetSec = Math.max(onsetSec, end);
    if (durationSec !== null && end >= durationSec - 0.2) tailStartSec = start;
  }
  return { onsetSec, tailStartSec };
}

/** Floor silence, then downsample the momentary-LUFS series to at most ENVELOPE_BINS bins. */
function buildEnvelope(raw: number[]): number[] {
  if (!raw.length) return [];
  const vals = raw.map((m) => (m < SILENCE_FLOOR_LUFS ? SILENCE_FLOOR_LUFS : m));
  const round1 = (v: number) => Math.round(v * 10) / 10;
  if (vals.length <= ENVELOPE_BINS) return vals.map(round1);
  const out: number[] = [];
  for (let i = 0; i < ENVELOPE_BINS; i++) {
    const start = Math.floor((i * vals.length) / ENVELOPE_BINS);
    const end = Math.max(start + 1, Math.floor(((i + 1) * vals.length) / ENVELOPE_BINS));
    let sum = 0;
    let n = 0;
    for (let j = start; j < end && j < vals.length; j++) {
      sum += vals[j] as number;
      n++;
    }
    out.push(round1(sum / n));
  }
  return out;
}

/** Unicode sparkline of the loudness contour (build/drop/break at a glance). */
export function envelopeSparkline(envelope: number[]): string {
  if (!envelope.length) return "";
  const blocks = "▁▂▃▄▅▆▇█";
  const max = Math.max(...envelope);
  const min = Math.min(...envelope);
  const span = Math.max(1e-6, max - min);
  return envelope
    .map((v) => {
      const idx = Math.min(7, Math.max(0, Math.round(((v - min) / span) * 7)));
      return blocks[idx];
    })
    .join("");
}

/** Human-readable lines for the terminal (no color — caller wraps as needed). */
export function formatAnalysisLines(a: AudioAnalysis): string[] {
  const s = (n: number | null, unit: string, digits = 2) =>
    n === null ? "—" : `${n.toFixed(digits)}${unit}`;
  const loud = a.integratedLufs === null ? "—" : `${a.integratedLufs.toFixed(1)} LUFS`;
  const peak = a.truePeakDb === null ? "—" : `${a.truePeakDb.toFixed(1)} dBFS`;
  const out = [
    `loudness ${loud}   true-peak ${peak}`,
    `peak at ${s(a.peakTimeSec, "s")}   onset ${s(a.onsetSec, "s")}   tail ${s(a.tailStartSec, "s")}`,
  ];
  // Suggested trim window when the clip carries silence padding — so a padded
  // riser/whoosh plays only its real content instead of firing late on dead air.
  const end = a.tailStartSec ?? a.durationSec;
  const hasDeadAir = a.onsetSec > 0.05 || a.tailStartSec !== null;
  if (hasDeadAir && end !== null && end > a.onsetSec) {
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const parts: string[] = [];
    if (a.onsetSec > 0.05) parts.push(`data-media-start=${r2(a.onsetSec)}`);
    parts.push(`data-duration=${r2(end - a.onsetSec)}`);
    out.push(`trim  ${parts.join(" ")}`);
  }
  const spark = envelopeSparkline(a.envelope);
  if (spark) out.push(`shape ${spark}`);
  return out;
}
