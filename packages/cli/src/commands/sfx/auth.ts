/**
 * SFX access gate. The catalog is free, but searching/downloading it needs a
 * HeyGen API key. Rather than letting the API call fail with a raw 401, the
 * network-touching subcommands (`search`, `add`) call this first: if no
 * credential resolves, it prints a friendly opt-in (get a free key, set it, or
 * skip SFX) — mirroring how the VO/Gemini steps ask — and the caller bails.
 *
 * `list` and `inspect` are local and don't gate on this.
 */

import { tryResolveCredential } from "../../auth/resolver.js";
import { c } from "../../ui/colors.js";

const SFX_SIGNUP_URL = "https://app.heygen.com/developers/api";

/**
 * Returns true if a HeyGen credential is available. If not, prints guidance
 * (human or JSON) and returns false — the caller should stop.
 */
export async function requireSfxKey(json = false): Promise<boolean> {
  const cred = await tryResolveCredential();
  if (cred) return true;

  if (json) {
    console.log(
      JSON.stringify({
        error: "missing_api_key",
        message: "Sound effects need a free HeyGen API key.",
        get_key_url: SFX_SIGNUP_URL,
        set_via: ["HEYGEN_API_KEY in a .env file or environment", "hyperframes auth login"],
      }),
    );
    return false;
  }

  console.log(`\n  ${c.bold("Sound effects need a free HeyGen API key.")}`);
  console.log(`  ${c.dim("HeyGen's SFX catalog is free — you just need a key to search it.")}`);
  console.log(`  ${c.dim("Get one at")} ${c.accent(SFX_SIGNUP_URL)}`);
  console.log(
    `  ${c.dim("then add")} ${c.accent("HEYGEN_API_KEY=your-key")} ${c.dim("to a .env file, or run")} ${c.accent("hyperframes auth login")}${c.dim(".")}`,
  );
  console.log(`  ${c.dim("Or skip SFX — the video just won't have them.")}\n`);
  return false;
}
