import { describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VALID_CANVAS_RESOLUTIONS } from "../../core.types";
import { registerRenderRoutes } from "./render";
import type { StudioApiAdapter } from "../types";

function createAdapter(
  startRenderSpy: ReturnType<typeof vi.fn>,
  rendersDir = mkdtempSync(join(tmpdir(), "hf-render-test-")),
): { adapter: StudioApiAdapter; rendersDir: string } {
  const adapter: StudioApiAdapter = {
    listProjects: () => [],
    resolveProject: async (id: string) => ({ id, dir: "/tmp/proj" }),
    bundle: async () => null,
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/api/runtime.js",
    rendersDir: () => rendersDir,
    startRender: (opts) => {
      startRenderSpy(opts);
      return {
        id: opts.jobId,
        status: "rendering",
        progress: 0,
        outputPath: opts.outputPath,
      };
    },
  };
  return { adapter, rendersDir };
}

function buildApp(spy: ReturnType<typeof vi.fn>): { app: Hono; cleanup: () => void } {
  const { adapter, rendersDir } = createAdapter(spy);
  const app = new Hono();
  registerRenderRoutes(app, adapter);
  return { app, cleanup: () => rmSync(rendersDir, { recursive: true, force: true }) };
}

describe("POST /projects/:id/render — outputResolution forwarding", () => {
  it("forwards a valid resolution preset to the adapter", async () => {
    const spy = vi.fn();
    const { app, cleanup } = buildApp(spy);
    try {
      const res = await app.request("http://localhost/projects/demo/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fps: 30,
          quality: "high",
          format: "mp4",
          resolution: "landscape-4k",
        }),
      });
      expect(res.status).toBe(200);
      expect(spy).toHaveBeenCalledOnce();
      const opts = spy.mock.calls[0][0];
      expect(opts.outputResolution).toBe("landscape-4k");
    } finally {
      cleanup();
    }
  });

  it("omits outputResolution when the request does not specify one", async () => {
    const spy = vi.fn();
    const { app, cleanup } = buildApp(spy);
    try {
      const res = await app.request("http://localhost/projects/demo/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fps: 30, quality: "standard", format: "mp4" }),
      });
      expect(res.status).toBe(200);
      const opts = spy.mock.calls[0][0];
      expect(opts.outputResolution).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("drops an invalid resolution string (defense-in-depth, not a 400)", async () => {
    // The route is intentionally lenient on unknown enum values — the producer
    // is the source of truth for validation and emits a clear error message.
    // We just want to make sure garbage doesn't propagate as if it were valid.
    const spy = vi.fn();
    const { app, cleanup } = buildApp(spy);
    try {
      const res = await app.request("http://localhost/projects/demo/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fps: 30, quality: "standard", format: "mp4", resolution: "8k" }),
      });
      expect(res.status).toBe(200);
      const opts = spy.mock.calls[0][0];
      expect(opts.outputResolution).toBeUndefined();
    } finally {
      cleanup();
    }
  });

  it("accepts each canonical preset value", async () => {
    for (const preset of VALID_CANVAS_RESOLUTIONS) {
      const spy = vi.fn();
      const { app, cleanup } = buildApp(spy);
      try {
        await app.request("http://localhost/projects/demo/render", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fps: 30, quality: "standard", format: "mp4", resolution: preset }),
        });
        expect(spy.mock.calls[0][0].outputResolution).toBe(preset);
      } finally {
        cleanup();
      }
    }
  });
});
