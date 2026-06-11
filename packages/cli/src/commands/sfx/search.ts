import { defineCommand } from "citty";
import { resolve } from "node:path";
import * as clack from "@clack/prompts";
import type { Example } from "../_examples.js";
import { c } from "../../ui/colors.js";
import { createCloudClient } from "../../cloud/index.js";
import { reportApiError } from "../../cloud/errors.js";
import { writeSearchCache, type CachedSfx } from "./state.js";
import { requireSfxKey } from "./auth.js";

export const examples: Example[] = [
  ["Search the catalog by meaning", 'hyperframes sfx search "whoosh for a scene change"'],
  ["Punchy UI sound, fewer results", 'hyperframes sfx search "punchy ui tap" --limit 5'],
  ["JSON output (for agents)", 'hyperframes sfx search "cinematic impact boom" --json'],
];

export default defineCommand({
  meta: {
    name: "search",
    description: "Semantic search over the HeyGen sound-effects catalog",
  },
  args: {
    query: {
      type: "positional",
      description: "Natural-language description of the sound you want (function + character)",
      required: true,
    },
    limit: { type: "string", description: "Max results (default 10)", alias: "n" },
    minScore: {
      type: "string",
      description: "Minimum similarity score 0–1 (default 0.2, exploratory)",
    },
    dir: { type: "string", description: "Project directory (default: current directory)" },
    json: { type: "boolean", description: "Output results as JSON (for agents)", default: false },
  },
  // CLI entrypoint: arg parsing + spinner + json/human + error paths.
  // fallow-ignore-next-line complexity
  async run({ args }) {
    const projectDir = resolve(args.dir ?? ".");
    const limit = args.limit ? Number.parseInt(args.limit, 10) : 10;
    const minScore = args.minScore ? Number.parseFloat(args.minScore) : 0.2;

    if (!(await requireSfxKey(args.json))) return;

    const spin = args.json ? null : clack.spinner();
    spin?.start(`Searching sound effects for "${args.query}"...`);
    try {
      const client = await createCloudClient();
      const res = await client.searchSounds({
        query: args.query,
        type: "sound_effects",
        limit,
        min_score: minScore,
      });
      const now = Date.now();
      const items: CachedSfx[] = (res.data ?? []).map((it) => ({
        id: it.id,
        name: it.name,
        description: it.description,
        duration: it.duration ?? null,
        score: it.score,
        audio_url: it.audio_url,
        query: args.query,
        fetchedAt: now,
      }));

      // Cache so `sfx add <id>` can resolve the (expiring) download URL.
      try {
        writeSearchCache(projectDir, items);
      } catch {
        /* cache is best-effort; add can still refresh by re-searching */
      }

      if (args.json) {
        console.log(
          JSON.stringify({
            items: items.map(({ query: _q, fetchedAt: _f, ...rest }) => rest),
            has_more: res.has_more ?? false,
            next_token: res.next_token ?? null,
          }),
        );
        return;
      }

      spin?.stop(
        c.success(
          `Found ${items.length} sound${items.length === 1 ? "" : "s"} for "${args.query}"`,
        ),
      );
      if (items.length === 0) {
        console.log(c.dim("  No matches — try a broader description, or lower --minScore."));
        return;
      }
      for (const it of items) {
        const dur = it.duration != null ? `${it.duration.toFixed(2)}s` : "?";
        console.log(
          `  ${c.accent(it.id)}  ${c.bold(it.name)}  ${c.dim(`${dur} · score ${it.score.toFixed(3)}`)}`,
        );
        const desc =
          it.description.length > 96 ? `${it.description.slice(0, 96)}…` : it.description;
        console.log(`    ${c.dim(desc)}`);
      }
      console.log(
        `\n  ${c.dim("Add one to your project:")}  ${c.accent("hyperframes sfx add <id>")}`,
      );
    } catch (err) {
      spin?.stop(c.error("Search failed"));
      reportApiError("SFX search failed", err);
    }
  },
});
