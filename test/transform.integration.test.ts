import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { listCredentialedProviders } from "../src/auth";
import { normalizeConfig } from "../src/config";
import {
  getModel,
  modelSupportsModality,
  providerEnv,
  providerNpm,
  supportedInputModalities,
  DEFAULT_CUSTOM_PROVIDER_NPM,
} from "../src/models";
import {
  distinctModalities,
  findUnsupportedAttachments,
  replaceWithText,
  type MessageContainer,
} from "../src/parts";
import { isSupportedProviderPackage } from "../src/describe";
import type { Modality, ModelsData, PluginConfig, SelectedFallback } from "../src/types";

const fp = fileURLToPath(new URL("./fixtures/models.json", import.meta.url));
const ap = fileURLToPath(new URL("./fixtures/auth.json", import.meta.url));
const data = JSON.parse(readFileSync(fp, "utf8")) as ModelsData;

function selectFallback(
  data: ModelsData,
  config: PluginConfig,
  credentialed: Set<string>,
  modality: Modality,
  providerConfig?: Record<
    string,
    { apiKey?: string; baseURL?: string; npm?: string; models?: Record<string, unknown> }
  >,
): SelectedFallback | null {
  const entry = config.modalities[modality];
  const pid = entry?.providerID;
  const mid = entry?.modelID;
  if (!pid || !mid) return null;
  if (!credentialed.has(pid)) return null;
  const pc = providerConfig?.[pid];
  const npm = providerNpm(data, pid) ?? pc?.npm ?? (pc ? DEFAULT_CUSTOM_PROVIDER_NPM : undefined);
  if (!isSupportedProviderPackage(npm)) return null;
  const providerInData = data[pid];
  if (providerInData) {
    const model = getModel(data, pid, mid);
    if (model && !modelSupportsModality(model, modality)) return null;
    if (!model && !pc) return null;
    return { providerID: pid, modelID: mid, npm, env: providerEnv(data, pid) };
  }
  if (pc) return { providerID: pid, modelID: mid, npm, env: [] };
  return null;
}

function filePart(mime: string, url: string, filename?: string) {
  return {
    id: `p-${mime}`,
    sessionID: "s1",
    messageID: "m1",
    type: "file" as const,
    mime,
    url,
    ...(filename ? { filename } : {}),
  };
}

describe("transform pipeline (stubbed describe)", () => {
  it("plans image + pdf for a text-only active model", () => {
    const config = normalizeConfig({
      modalities: {
        image: { enabled: true, providerID: "anthropic", modelID: "claude-vision" },
        pdf: { enabled: true, providerID: "anthropic", modelID: "claude-vision" },
      },
    });
    const credentialed = listCredentialedProviders(data, { authPath: ap });

    const messages: MessageContainer[] = [
      {
        info: { sessionID: "s1", role: "user" },
        parts: [
          { type: "text", text: "what are these?" },
          filePart("image/png", "data:image/png;base64,AAAA", "shot.png"),
          filePart("application/pdf", "data:application/pdf;base64,BBBB"),
        ],
      },
    ];

    const supported = supportedInputModalities(data, "anthropic", "claude-text-only");
    expect([...supported]).toEqual([]);

    const missing = new Set<Modality>();
    for (const m of ["image", "pdf", "audio"] as const) {
      if (config.modalities[m].enabled && config.modalities[m].providerID && !supported.has(m))
        missing.add(m);
    }
    expect([...missing].sort()).toEqual(["image", "pdf"]);

    const hits = findUnsupportedAttachments(messages, missing);
    expect(distinctModalities(hits)).toEqual(new Set(["image", "pdf"]));

    const plan = new Map<Modality, SelectedFallback>();
    for (const m of distinctModalities(hits)) {
      const fb = selectFallback(data, config, credentialed, m);
      plan.set(m, fb!);
    }
    expect(plan.get("image")?.modelID).toBe("claude-vision");

    // Replaced correctly
    replaceWithText(
      messages,
      hits,
      (hit) => `[desc ${hit.modality}]`,
      (m) => plan.get(m),
    );
    expect((messages[0]!.parts[1] as { type: string }).type).toBe("text");
    expect((messages[0]!.parts[2] as { type: string }).type).toBe("text");
  });

  it("returns empty plan when modality has no model configured", () => {
    const config = normalizeConfig({
      modalities: { image: { enabled: true, providerID: null, modelID: null } },
    });
    const msgs: MessageContainer[] = [
      { info: { sessionID: "s1" }, parts: [filePart("image/png", "data:...")] },
    ];
    const missing = new Set<Modality>(["image"]);
    const hits = findUnsupportedAttachments(msgs, missing);
    const plan = new Map<Modality, SelectedFallback>();
    const credentialed = listCredentialedProviders(data, { authPath: ap });
    for (const m of distinctModalities(hits)) {
      const fb = selectFallback(data, config, credentialed, m);
      if (fb) plan.set(m, fb);
    }
    expect(plan.size).toBe(0);
  });
});
