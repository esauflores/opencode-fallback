import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  fetchModelsData,
  getModel,
  loadModelsData,
  modelSupportsModality,
  resolveModelsData,
  supportedInputModalities,
} from "../src/models";
import type { ModelsData } from "../src/types";

const fp = fileURLToPath(new URL("./fixtures/models.json", import.meta.url));
const raw = readFileSync(fp, "utf8");
let data: ModelsData;

beforeEach(() => {
  data = JSON.parse(raw) as ModelsData;
});

describe("loadModelsData", () => {
  it("loads fixture", () => {
    const d = loadModelsData(fp);
    expect(d).not.toBeNull();
    expect(Object.keys(d!)).toContain("anthropic");
  });

  it("returns null for missing path", () => {
    expect(loadModelsData("/does/not/exist.json")).toBeNull();
  });
});

describe("fetchModelsData", () => {
  it("parses successful response", async () => {
    const m = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true, text: () => Promise.resolve(raw) } as Response);
    const r = await fetchModelsData("https://example.test/api.json");
    expect(r).not.toBeNull();
    expect(Object.keys(r!)).toContain("anthropic");
    m.mockRestore();
  });

  it("returns null on error", async () => {
    const m = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: false, text: () => Promise.resolve("") } as Response);
    expect(await fetchModelsData("https://example.test/api.json")).toBeNull();
    m.mockRestore();
  });
});

describe("resolveModelsData", () => {
  it("uses disk cache when available", async () => {
    const m = vi.spyOn(globalThis, "fetch");
    const r = await resolveModelsData(fp, "https://example.test/api.json");
    expect(r).not.toBeNull();
    expect(Object.keys(r!)).toContain("anthropic");
    expect(m).not.toHaveBeenCalled();
    m.mockRestore();
  });

  it("falls back to fetch", async () => {
    const m = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({ ok: true, text: () => Promise.resolve(raw) } as Response);
    const r = await resolveModelsData("/does/not/exist.json", "https://example.test/api.json");
    expect(r).not.toBeNull();
    expect(m).toHaveBeenCalledTimes(1);
    m.mockRestore();
  });
});

describe("supportedInputModalities", () => {
  it("derives from modalities.input", () => {
    expect([...supportedInputModalities(data, "anthropic", "claude-vision")].sort()).toEqual([
      "image",
      "pdf",
    ]);
    expect([...supportedInputModalities(data, "openai", "gpt-4o")].sort()).toEqual([
      "audio",
      "image",
    ]);
  });

  it("empty for text-only", () => {
    expect(supportedInputModalities(data, "anthropic", "claude-text-only").size).toBe(0);
  });

  it("empty for unknown model", () => {
    expect(supportedInputModalities(data, "anthropic", "nope").size).toBe(0);
  });
});

describe("modelSupportsModality", () => {
  it("attachment=true means image+pdf", () => {
    const m = getModel(data, "anthropic", "claude-vision")!;
    expect(modelSupportsModality({ ...m, modalities: undefined }, "image")).toBe(true);
    expect(modelSupportsModality({ ...m, modalities: undefined }, "pdf")).toBe(true);
    expect(modelSupportsModality({ ...m, modalities: undefined }, "audio")).toBe(false);
  });

  it("undefined model is false", () => {
    expect(modelSupportsModality(undefined, "image")).toBe(false);
  });
});
