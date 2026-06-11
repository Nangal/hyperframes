/**
 * `hyperframes sfx` — search and download sound effects from the HeyGen
 * catalog. Subverbs live in `./sfx/<name>.ts`, loaded dynamically so this
 * surface doesn't affect CLI cold-start.
 *
 * Auth reuses the existing cloud credential chain (`createCloudClient` →
 * `resolveCloudAuthHeaders`): `HEYGEN_API_KEY` or `hyperframes auth login`.
 * No new credential store, no new env var.
 */

import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";

export const examples: Example[] = [
  ["See what families are in the catalog", "hyperframes sfx list"],
  ["Search the SFX catalog by meaning", 'hyperframes sfx search "whoosh for a scene change"'],
  ["Download a clip into the project", "hyperframes sfx add 8b1ac2f2e69edd9b"],
  ["Measure a clip (loudness, peak time)", "hyperframes sfx inspect 8b1ac2f2e69edd9b"],
];

const HELP = `
${c.bold("hyperframes sfx")} ${c.dim("<subcommand>")}

Find and use sound effects from the HeyGen catalog — AI-generated whooshes,
impacts, UI tones, risers, foley, and more — searchable by description.

${c.bold("SUBCOMMANDS")}
  ${c.accent("list")}                   List the families in the catalog (start here)
  ${c.accent("search")} ${c.dim('"<description>"')}   Search the catalog by meaning
  ${c.accent("add")} ${c.dim("<id>")}              Download a clip into ./assets/sfx/
  ${c.accent("inspect")} ${c.dim("<id>")}          Measure loudness, peak time, onset/tail

${c.bold("EXAMPLE")}
  hyperframes sfx list
  hyperframes sfx search "whoosh for a scene change"
  hyperframes sfx add <id>
  hyperframes sfx inspect <id>
`;

export default defineCommand({
  meta: { name: "sfx", description: "Search and download sound effects from the HeyGen catalog" },
  subCommands: {
    list: () => import("./sfx/list.js").then((m) => m.default),
    search: () => import("./sfx/search.js").then((m) => m.default),
    add: () => import("./sfx/add.js").then((m) => m.default),
    inspect: () => import("./sfx/inspect.js").then((m) => m.default),
  },
  run({ args }) {
    if (!args._?.[0]) console.log(HELP);
  },
});
