import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ModelEntry,
  ModelsData,
  Modality,
  ProviderConfigMap,
  ProviderEntry,
} from "./types.js";
import { isNonEmpty } from "./util.js";

// ---- paths ----

function cacheDir(): string {
  const d = process.env.XDG_CACHE_HOME;
  return path.join(d && d.trim() ? d : path.join(os.homedir(), ".cache"), "opencode");
}

function modelsJsonPath(): string {
  return path.join(cacheDir(), "models.json");
}

// ---- data loading ----

const MODELS_SOURCE = process.env.OPENCODE_MODELS_URL ?? "https://models.dev";
const FETCH_TIMEOUT_MS = 10_000;

function parseModelsData(json: string): ModelsData {
  const data = JSON.parse(json);
  if (!data || typeof data !== "object") throw new Error("models.json is not a JSON object");
  return data as ModelsData;
}

export function loadModelsData(p: string = modelsJsonPath()): ModelsData | null {
  try {
    return parseModelsData(fsSync.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function apiUrl(source = MODELS_SOURCE): string {
  return source.endsWith("/api.json") ? source : `${source}/api.json`;
}

export async function fetchModelsData(url: string = apiUrl()): Promise<ModelsData | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    return r.ok ? parseModelsData(await r.text()) : null;
  } catch {
    return null;
  }
}

export async function resolveModelsData(
  p: string = modelsJsonPath(),
  url: string = apiUrl(),
): Promise<ModelsData | null> {
  return loadModelsData(p) ?? (await fetchModelsData(url));
}

// ---- model lookups ----

export function getModel(
  data: ModelsData,
  providerID: string,
  modelID: string,
): ModelEntry | undefined {
  return data[providerID]?.models?.[modelID];
}

export function modelSupportsModality(model: ModelEntry | undefined, modality: Modality): boolean {
  if (!model) return false;
  const input = model.modalities?.input;
  if (Array.isArray(input)) return input.includes(modality);
  if (model.attachment) return modality === "image" || modality === "pdf";
  return false;
}

export function supportedInputModalities(
  data: ModelsData,
  providerID: string,
  modelID: string,
): Set<Modality> {
  const out = new Set<Modality>();
  const model = getModel(data, providerID, modelID);
  if (!model) return out;
  const input = model.modalities?.input;
  if (Array.isArray(input)) {
    for (const v of input)
      if (v === "image" || v === "pdf" || v === "audio" || v === "video") out.add(v);
  } else if (model.attachment) {
    out.add("image");
    out.add("pdf");
  }
  return out;
}

export function listProviders(data: ModelsData): ProviderEntry[] {
  return Object.values(data);
}

export function listProviderModels(data: ModelsData, providerID: string): ModelEntry[] {
  return Object.values(data[providerID]?.models ?? {});
}

export function providerNpm(data: ModelsData, providerID: string): string | undefined {
  return data[providerID]?.npm;
}

export function providerEnv(data: ModelsData, providerID: string): string[] {
  return data[providerID]?.env ?? [];
}

export function modelDisplayName(model: ModelEntry): string {
  return model.name || model.id;
}

export function providerDisplayName(provider: ProviderEntry): string {
  return provider.name || provider.id;
}

// ---- opencode config merging ----

export const DEFAULT_CUSTOM_PROVIDER_NPM = "@ai-sdk/openai-compatible";

export function providerConfigFromOpencodeConfig(config: unknown): ProviderConfigMap {
  const root = asRecord(config);
  const provider = asRecord(root?.provider);
  if (!provider) return {};
  const out: ProviderConfigMap = {};
  for (const [id, raw] of Object.entries(provider)) {
    if (!isNonEmpty(id)) continue;
    const entry = asRecord(raw);
    if (!entry) continue;
    const opts = asRecord(entry.options);
    const pc = {
      apiKey: nonEmptyString(opts?.apiKey),
      baseURL: nonEmptyString(opts?.baseURL),
      npm: nonEmptyString(entry.npm),
      name: nonEmptyString(entry.name),
      models: parseModels(entry.models),
    };
    if (pc.apiKey || pc.baseURL || pc.npm || pc.name || pc.models) out[id] = pc;
  }
  return out;
}

export function mergeProviderConfigModels(
  data: ModelsData,
  providerConfig: ProviderConfigMap,
): ModelsData {
  const merged: ModelsData = { ...data };
  for (const [providerID, config] of Object.entries(providerConfig)) {
    const existing = merged[providerID];
    if (!existing && !config.models) continue;
    merged[providerID] = {
      ...(existing ?? { id: providerID, env: [] }),
      id: existing?.id ?? providerID,
      env: existing?.env ?? [],
      npm: config.npm ?? existing?.npm ?? DEFAULT_CUSTOM_PROVIDER_NPM,
      name: config.name ?? existing?.name,
      models: config.models ? { ...existing?.models, ...config.models } : existing?.models,
    };
  }
  return merged;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function nonEmptyString(v: unknown): string | undefined {
  return typeof v === "string" && isNonEmpty(v) ? v : undefined;
}

function parseModels(v: unknown): Record<string, ModelEntry> | undefined {
  const models = asRecord(v);
  if (!models) return undefined;
  const out: Record<string, ModelEntry> = {};
  for (const [id, raw] of Object.entries(models)) {
    if (!isNonEmpty(id)) continue;
    const m = asRecord(raw);
    if (!m) continue;
    out[id] = { ...(m as unknown as ModelEntry), id: nonEmptyString(m.id) ?? id };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
