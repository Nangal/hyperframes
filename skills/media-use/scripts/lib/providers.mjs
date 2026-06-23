import { sfxProvider } from "./sfx-provider.mjs";
import { imageProvider, iconProvider } from "./image-provider.mjs";

function stubProvider(type) {
  return {
    async search() {
      return null;
    },
    async generate() {
      return null;
    },
    type,
  };
}

const registry = {
  bgm: stubProvider("bgm"),
  sfx: { ...sfxProvider, type: "sfx" },
  voice: stubProvider("voice"),
  image: { ...imageProvider, type: "image" },
  icon: { ...iconProvider, type: "icon" },
  brand: stubProvider("brand"),
};

export function getProvider(type) {
  const p = registry[type];
  if (!p) throw new Error(`unknown media type: ${type}`);
  return p;
}

export function registerProvider(type, provider) {
  registry[type] = { ...provider, type };
}

export function listTypes() {
  return Object.keys(registry);
}
