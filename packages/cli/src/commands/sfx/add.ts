import { defineCommand } from "citty";
import { join, relative, resolve } from "node:path";
import * as clack from "@clack/prompts";
import type { Example } from "../_examples.js";
import { c } from "../../ui/colors.js";
import { errorBox } from "../../ui/format.js";
import { createCloudClient, downloadToFile } from "../../cloud/index.js";
import { reportApiError } from "../../cloud/errors.js";
import { readCachedSfx, sfxDir, writeSearchCache } from "./state.js";
import { analyzeAudio, formatAnalysisLines, type AudioAnalysis } from "./analyze.js";
import { requireSfxKey } from "./auth.js";

export const examples: Example[] = [
  ["Download a clip from a prior search", "hyperframes sfx add 8b1ac2f2e69edd9b"],
  ["Add into a specific project", "hyperframes sfx add 8b1ac2f2e69edd9b --dir ./my-video"],
];

// Presigned URLs are short-lived; refresh anything older than this.
const URL_TTL_MS = 10 * 60 * 1000;

export default defineCommand({
  meta: {
    name: "add",
    description: "Download a sound effect into the project's assets/sfx/ directory",
  },
  args: {
    id: {
      type: "positional",
      description: "The SFX id from `hyperframes sfx search`",
      required: true,
    },
    dir: { type: "string", description: "Project directory (default: current directory)" },
    json: { type: "boolean", description: "Output result as JSON", default: false },
  },
  // CLI entrypoint: arg parsing + URL refresh + analysis + json/human + error paths.
  // fallow-ignore-next-line complexity
  async run({ args }) {
    const projectDir = resolve(args.dir ?? ".");
    if (!(await requireSfxKey(args.json))) return;
    const entry = readCachedSfx(projectDir, args.id);
    if (!entry) {
      errorBox(
        "Unknown SFX id",
        `No cached result for "${args.id}".`,
        'Run `hyperframes sfx search "<description>"` first, then add by id.',
      );
      process.exit(1);
    }

    const spin = args.json ? null : clack.spinner();
    spin?.start(`Adding ${entry.name}...`);
    try {
      // Refresh the (expiring) presigned URL by re-running the cached query.
      let url = entry.audio_url;
      if (Date.now() - entry.fetchedAt > URL_TTL_MS) {
        const client = await createCloudClient();
        const res = await client.searchSounds({
          query: entry.query,
          type: "sound_effects",
          limit: 50,
        });
        const fresh = (res.data ?? []).find((it) => it.id === args.id);
        if (fresh) {
          url = fresh.audio_url;
          writeSearchCache(projectDir, [
            { ...entry, audio_url: fresh.audio_url, fetchedAt: Date.now() },
          ]);
        }
      }

      const dest = join(sfxDir(projectDir), `${args.id}${extFromUrl(url)}`);
      const result = await downloadToFile(
        url,
        dest,
        spin
          ? {
              onProgress: (b, t) =>
                spin.message(
                  t
                    ? `Downloading ${Math.round((b / t) * 100)}%`
                    : `Downloaded ${(b / 1024).toFixed(0)} KB`,
                ),
            }
          : {},
      );
      const rel = relative(projectDir, result.path) || result.path;
      const dur = (entry.duration ?? 1).toFixed(2);

      // Measure the clip so the agent can place + balance it without hearing it.
      // Best-effort: ffmpeg is optional, so a missing binary just omits the analysis.
      let analysis: AudioAnalysis | null = null;
      try {
        analysis = await analyzeAudio(result.path);
      } catch {
        /* ffmpeg not installed or unreadable clip — skip the analysis */
      }

      if (args.json) {
        console.log(
          JSON.stringify({
            ok: true,
            id: args.id,
            name: entry.name,
            path: rel,
            duration: entry.duration,
            analysis,
          }),
        );
        return;
      }
      spin?.stop(c.success(`Added ${c.accent(entry.name)} → ${c.accent(rel)}`));
      console.log(c.dim("  Embed it as a clip (volume low under voiceover):"));
      console.log(
        `  ${c.dim(`<audio src="${rel}" data-start="0" data-duration="${dur}" data-volume="0.3"></audio>`)}`,
      );
      if (analysis) {
        for (const line of formatAnalysisLines(analysis)) console.log(`  ${c.dim(line)}`);
      }
    } catch (err) {
      spin?.stop(c.error("Add failed"));
      reportApiError("SFX download failed", err);
    }
  },
});

/** Pick the file extension from a (possibly query-stringed) URL; default .flac. */
function extFromUrl(url: string): string {
  const match = (url.split("?")[0] ?? url).match(/\.(flac|mp3|wav|m4a|ogg)$/i);
  return match ? match[0].toLowerCase() : ".flac";
}
