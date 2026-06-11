import { describe, expect, it } from "vitest";
import { envelopeSparkline, formatAnalysisLines, parseFfmpegAnalysis } from "./analyze.js";

// Shaped after real `ffmpeg -af ebur128=peak=true,silencedetect=...` stderr:
// 0.5s lead silence, a tone that peaks ~0.9s, 0.5s trailing silence to EOF (2.0s).
const FULL = `  Duration: 00:00:02.00, bitrate: 705 kb/s
[Parsed_silencedetect_1 @ 0x0] silence_start: 0
[Parsed_ebur128_0 @ 0x0] t: 0.0999773  TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU  FTPK:  -inf dBFS  TPK:  -inf dBFS
[Parsed_silencedetect_1 @ 0x0] silence_end: 0.5 | silence_duration: 0.5
[Parsed_ebur128_0 @ 0x0] t: 0.899977   TARGET:-23 LUFS    M: -20.0 S:-120.7     I: -22.0 LUFS       LRA:   0.0 LU  FTPK:  -inf dBFS  TPK: -18.1 dBFS
[Parsed_ebur128_0 @ 0x0] t: 1.399977   TARGET:-23 LUFS    M: -24.0 S:-120.7     I: -22.5 LUFS       LRA:   0.0 LU  FTPK:  -inf dBFS  TPK: -18.1 dBFS
[Parsed_silencedetect_1 @ 0x0] silence_start: 1.5
  Integrated loudness:
    I:         -22.9 LUFS
  True peak:
    Peak:      -18.1 dBFS
`;

describe("parseFfmpegAnalysis", () => {
  it("extracts duration, loudness, true peak, peak time, onset, and tail", () => {
    const a = parseFfmpegAnalysis(FULL);
    expect(a.durationSec).toBe(2);
    expect(a.integratedLufs).toBe(-22.9); // the summary value, not the per-frame running I:
    expect(a.truePeakDb).toBe(-18.1);
    expect(a.peakTimeSec).toBeCloseTo(0.9, 1); // loudest momentary M (-20.0), not the silent frames
    expect(a.onsetSec).toBeCloseTo(0.5, 2); // end of the leading silence
    expect(a.tailStartSec).toBeCloseTo(1.5, 2); // trailing silence runs to EOF without a silence_end
    // contour: silent frame floored to -70, then the two audible frames
    expect(a.envelope).toEqual([-70, -20, -24]);
  });

  it("builds an empty envelope and sparkline when there are no momentary lines", () => {
    expect(parseFfmpegAnalysis("").envelope).toEqual([]);
    expect(envelopeSparkline([])).toBe("");
  });

  it("renders a sparkline spanning low→high blocks across the contour", () => {
    const spark = envelopeSparkline([-70, -20, -24]);
    expect(spark).toHaveLength(3);
    expect(spark[0]).toBe("▁"); // quietest → lowest block
    expect(spark[1]).toBe("█"); // loudest → highest block
  });

  it("ignores silent frames (M ≈ -120) when finding the peak", () => {
    // Only silence-level momentary lines → no defensible peak.
    const silentish = `  Duration: 00:00:01.00, bitrate: 705 kb/s
[Parsed_ebur128_0 @ 0x0] t: 0.5  TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS  LRA: 0.0 LU
`;
    expect(parseFfmpegAnalysis(silentish).peakTimeSec).toBeNull();
  });

  it("reports onset 0 and tail null for a clip with no detected silence", () => {
    const hot = `  Duration: 00:00:01.00, bitrate: 705 kb/s
[Parsed_ebur128_0 @ 0x0] t: 0.3  TARGET:-23 LUFS    M: -12.0 S:-15.0  I: -12.0 LUFS  LRA: 0.0 LU
  Integrated loudness:
    I:         -12.0 LUFS
  True peak:
    Peak:       -1.0 dBFS
`;
    const a = parseFfmpegAnalysis(hot);
    expect(a.onsetSec).toBe(0);
    expect(a.tailStartSec).toBeNull();
    expect(a.peakTimeSec).toBeCloseTo(0.3, 2);
    expect(a.truePeakDb).toBe(-1);
  });

  it("emits a trim line with the effective window when the clip has dead air", () => {
    const a = parseFfmpegAnalysis(FULL); // onset 0.5, tail 1.5, dur 2.0
    const trim = formatAnalysisLines(a).find((l) => l.startsWith("trim"));
    expect(trim).toBeDefined();
    expect(trim).toContain("data-media-start=0.5");
    expect(trim).toContain("data-duration=1"); // tail(1.5) − onset(0.5)
  });

  it("omits the trim line when the clip starts hot and has no trailing silence", () => {
    const hot = parseFfmpegAnalysis(
      "  Duration: 00:00:01.00, bitrate: 705 kb/s\n[Parsed_ebur128_0 @ 0x0] t: 0.3 M: -12.0 I: -12.0 LUFS\n",
    );
    expect(formatAnalysisLines(hot).some((l) => l.startsWith("trim"))).toBe(false);
  });

  it("returns nulls gracefully on empty input", () => {
    const a = parseFfmpegAnalysis("");
    expect(a.durationSec).toBeNull();
    expect(a.integratedLufs).toBeNull();
    expect(a.peakTimeSec).toBeNull();
    expect(a.onsetSec).toBe(0);
    expect(a.tailStartSec).toBeNull();
  });
});
