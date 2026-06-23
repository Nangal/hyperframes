import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const HEYGEN_BASE = "https://api.heygen.com/v3";

function resolveCredential() {
  const envKey = process.env.HEYGEN_API_KEY || process.env.HYPERFRAMES_API_KEY;
  if (envKey) return { "X-Api-Key": envKey };
  const file = join(process.env.HEYGEN_CONFIG_DIR || join(homedir(), ".heygen"), "credentials");
  if (!existsSync(file)) return null;
  const raw = readFileSync(file, "utf8").trim();
  if (!raw) return null;
  if (!raw.startsWith("{")) return { "X-Api-Key": raw };
  try {
    const cred = JSON.parse(raw);
    if (cred.oauth?.access_token) return { Authorization: `Bearer ${cred.oauth.access_token}` };
    if (cred.api_key) return { "X-Api-Key": cred.api_key };
  } catch { /* malformed */ }
  return null;
}

async function searchAssets(query, type = "image", { limit = 5, minScore = 0.3 } = {}) {
  const headers = resolveCredential();
  if (!headers) return null;
  const params = new URLSearchParams({ query, type, limit: String(limit), min_score: String(minScore) });
  const res = await fetch(`${HEYGEN_BASE}/assets/search?${params}`, {
    headers: { ...headers, "X-HeyGen-Client-Origin": "media-use" },
  });
  if (!res.ok) return null;
  const payload = await res.json();
  const data = payload?.data;
  if (!Array.isArray(data) || data.length === 0) return null;
  return data;
}

export const imageProvider = {
  async search(intent) {
    const results = await searchAssets(intent, "image");
    if (!results) return null;
    const best = results[0];
    return {
      url: best.url,
      source: "search",
      ext: ".jpg",
      metadata: {
        description: intent,
        width: best.width || null,
        height: best.height || null,
        transparent: best.is_transparent || false,
        provider: "heygen.asset.search",
        provenance: { asset_id: best.id, score: best.score },
      },
    };
  },
};

export const iconProvider = {
  async search(intent) {
    const results = await searchAssets(intent, "icon", { minScore: 0.2 });
    if (!results) return null;
    const best = results[0];
    return {
      url: best.url,
      source: "search",
      ext: ".svg",
      metadata: {
        description: intent,
        transparent: true,
        provider: "heygen.asset.search",
        provenance: { asset_id: best.id, score: best.score, type: "icon" },
      },
    };
  },
};
