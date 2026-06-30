import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mergeProviderConfigModels, providerConfigFromOpencodeConfig } from "../src/models";
import type { ModelsData } from "../src/types";

const fp = fileURLToPath(new URL("./fixtures/models.json", import.meta.url));
const data = JSON.parse(readFileSync(fp, "utf8")) as ModelsData;

describe("providerConfigFromOpencodeConfig", () => {
  it("parses provider config", () => {
    const r = providerConfigFromOpencodeConfig({
      provider: {
        gateway: {
          name: "Gateway",
          npm: "@ai-sdk/openai-compatible",
          options: { apiKey: "sk-...", baseURL: "https://gw.example.com/v1" },
          models: { "gpt-4o": { id: "gpt-4o" } },
        },
      },
    });
    expect(r.gateway?.apiKey).toBe("sk-...");
    expect(r.gateway?.baseURL).toBe("https://gw.example.com/v1");
    expect(r.gateway?.models?.gpt_4o).toBeFalsy();
  });

  it("skips empty providers", () => {
    expect(providerConfigFromOpencodeConfig({ provider: { empty: {} } })).toEqual({});
  });

  it("returns empty for non-object config", () => {
    expect(providerConfigFromOpencodeConfig(null)).toEqual({});
  });
});

describe("mergeProviderConfigModels", () => {
  it("adds custom provider entries", () => {
    const pc = {
      gateway: { npm: "@ai-sdk/openai-compatible", models: { "gpt-4o": { id: "gpt-4o" } } },
    };
    const merged = mergeProviderConfigModels(data, pc);
    expect(merged.gateway?.models?.["gpt-4o"]?.id).toBe("gpt-4o");
  });

  it("merges into existing provider", () => {
    const pc = { anthropic: { models: { "claude-custom": { id: "claude-custom" } } } };
    const merged = mergeProviderConfigModels(data, pc);
    expect(merged.anthropic?.models?.["claude-vision"]).toBeTruthy();
    expect(merged.anthropic?.models?.["claude-custom"]?.id).toBe("claude-custom");
  });
});
