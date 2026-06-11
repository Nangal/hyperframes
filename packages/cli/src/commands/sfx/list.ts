import { defineCommand } from "citty";
import type { Example } from "../_examples.js";
import { c } from "../../ui/colors.js";
import { CATALOG_MANIFEST } from "./catalog-manifest.js";

export const examples: Example[] = [
  ["See what's in the catalog before searching", "hyperframes sfx list"],
  ["Machine-readable map (for agents)", "hyperframes sfx list --json"],
];

export default defineCommand({
  meta: {
    name: "list",
    description:
      "List the sound-effect families in the catalog — see what's available before searching",
  },
  args: {
    json: {
      type: "boolean",
      description: "Output the catalog map as JSON (for agents)",
      default: false,
    },
  },
  run({ args }) {
    if (args.json) {
      console.log(JSON.stringify(CATALOG_MANIFEST));
      return;
    }
    const { totalClips, families } = CATALOG_MANIFEST;
    console.log(`  ${c.bold(`${totalClips} sound effects across ${families.length} families`)}`);
    console.log(
      c.dim(
        "  Pick the family that fits the moment, then search within it — don't default to the same whoosh.\n",
      ),
    );
    const pad = Math.max(...families.map((f) => f.category.length));
    for (const f of families) {
      console.log(`  ${c.accent(f.category.padEnd(pad))} ${c.dim(`(${f.count})`)}  ${f.use}`);
      console.log(`  ${" ".repeat(pad)}       ${c.dim(`e.g. ${f.examples.join(", ")}`)}`);
    }
    console.log(
      `\n  ${c.dim("Then:")}  ${c.accent('hyperframes sfx search "<function + character>"')}`,
    );
  },
});
