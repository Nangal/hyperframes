import { describe, expect, it } from "vitest";
import { CATALOG_MANIFEST, type SfxMode } from "./catalog-manifest.js";

const MODES: SfxMode[] = ["hit", "build", "bed", "sting", "meme"];

describe("CATALOG_MANIFEST", () => {
  it("is non-empty and self-consistent", () => {
    expect(CATALOG_MANIFEST.families.length).toBeGreaterThan(0);
    for (const f of CATALOG_MANIFEST.families) {
      expect(f.category).toMatch(/^[a-z]+$/);
      expect(f.count).toBeGreaterThan(0);
      expect(MODES).toContain(f.mode);
      expect(f.use.length).toBeGreaterThan(0);
      expect(f.examples.length).toBeGreaterThan(0);
      expect(f.examples.length).toBeLessThanOrEqual(3);
    }
  });

  it("totalClips equals the sum of family counts", () => {
    const sum = CATALOG_MANIFEST.families.reduce((n, f) => n + f.count, 0);
    expect(CATALOG_MANIFEST.totalClips).toBe(sum);
  });

  it("lists families largest-first so the common kinds surface first", () => {
    const counts = CATALOG_MANIFEST.families.map((f) => f.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it("covers the non-obvious families an agent tends to forget", () => {
    const cats = new Set(CATALOG_MANIFEST.families.map((f) => f.category));
    for (const c of ["meme", "ambience", "downlifter", "glitch", "stinger"])
      expect(cats).toContain(c);
  });
});
