import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultConfig,
  isModalityActive,
  normalizeConfig,
  readConfig,
  writeConfig,
} from "../src/config";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fb-config-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("defaultConfig", () => {
  it("ships enabled with no models", () => {
    const c = defaultConfig();
    expect(c.enabled).toBe(true);
    for (const m of ["image", "pdf", "audio", "video"] as const) {
      expect(c.modalities[m].providerID).toBeNull();
      expect(c.modalities[m].modelID).toBeNull();
    }
  });
});

describe("normalizeConfig", () => {
  it("fills defaults for unknown shapes", () => {
    expect(normalizeConfig(null).enabled).toBe(true);
    expect(normalizeConfig({}).enabled).toBe(true);
    expect(normalizeConfig({ enabled: false }).enabled).toBe(false);
  });

  it("accepts direct providerID/modelID", () => {
    const c = normalizeConfig({
      modalities: { image: { enabled: true, providerID: "openai", modelID: "gpt-4o" } },
    });
    expect(c.modalities.image.providerID).toBe("openai");
    expect(c.modalities.image.modelID).toBe("gpt-4o");
  });

  it("clamps numeric settings", () => {
    const c = normalizeConfig({
      settings: { concurrency: 99, per_call_timeout_ms: 1, cache_ttl_ms: -1 },
    });
    expect(c.settings.concurrency).toBe(16);
    expect(c.settings.per_call_timeout_ms).toBe(1000);
    expect(c.settings.cache_ttl_ms).toBe(0);
  });
});

describe("read/write roundtrip", () => {
  it("roundtrips", () => {
    const p = join(dir, "cfg.json");
    const c = normalizeConfig({
      modalities: {
        image: { enabled: true, providerID: "openai", modelID: "gpt-4o", prompt: "p" },
      },
    });
    writeConfig(c, p);
    expect(existsSync(p)).toBe(true);
    const r = readConfig(p);
    expect(r.modalities.image.providerID).toBe("openai");
    expect(r.modalities.image.prompt).toBe("p");
  });

  it("readConfig returns defaults for missing file", () => {
    expect(readConfig(join(dir, "missing.json"))).toEqual(defaultConfig());
  });
});

describe("isModalityActive", () => {
  it("only counts enabled with a model", () => {
    const c = normalizeConfig({
      modalities: {
        image: { enabled: true, providerID: "openai", modelID: "gpt-4o" },
        pdf: { enabled: true, providerID: null, modelID: null },
        audio: { enabled: false, providerID: "openai", modelID: "gpt-4o" },
      },
    });
    expect(isModalityActive(c, "image")).toBe(true);
    expect(isModalityActive(c, "pdf")).toBe(false);
    expect(isModalityActive(c, "audio")).toBe(false);
  });
});
