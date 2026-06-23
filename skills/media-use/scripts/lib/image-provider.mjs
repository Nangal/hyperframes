import { execSync } from "node:child_process";

function searchAssets(query, type = "image", { limit = 5, minScore = 0.3 } = {}) {
  try {
    const q = query.replace(/'/g, "'\\''");
    const cmd = `heygen asset search list --query '${q}' --type ${type} --limit ${limit} --min-score ${minScore}`;
    const out = execSync(cmd, {
      encoding: "utf8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const payload = JSON.parse(out);
    const data = payload?.data;
    if (!Array.isArray(data) || data.length === 0) return null;
    return data;
  } catch {
    return null;
  }
}

export const imageProvider = {
  async search(intent) {
    const results = searchAssets(intent, "image");
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
    const results = searchAssets(intent, "icon", { minScore: 0.2 });
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
