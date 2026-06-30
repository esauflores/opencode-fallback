import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { isModality, type Modality, type ModalityConfig, type PluginConfig } from "./types.js";

// ---- paths ----

function envDir(varName: string, fallback: string): string {
  const value = process.env[varName];
  return value && value.trim() ? value : fallback;
}

function dataDir(): string {
  return path.join(envDir("XDG_DATA_HOME", path.join(os.homedir(), ".local", "share")), "opencode");
}

function pluginConfigPath(): string {
  return path.join(dataDir(), "opencode-fallback.json");
}

export function resolvePluginConfigPathOption(value: string | undefined): string | undefined {
  if (!value || !value.trim()) return undefined;
  const resolved = path.resolve(value.replace(/^~(?=$|\/|\\)/, os.homedir()));
  const root = path.resolve(dataDir());
  const relative = path.relative(root, resolved);
  if (relative !== "" && (relative.startsWith("..") || path.isAbsolute(relative))) return undefined;
  return resolved;
}

// ---- config ----

const CONFIG_VERSION = 1;

export function defaultConfig(): PluginConfig {
  const modalities = {
    image: emptyModality(),
    pdf: emptyModality(),
    audio: emptyModality(),
    video: emptyModality(),
  } as Record<Modality, ModalityConfig>;
  return {
    version: CONFIG_VERSION,
    enabled: true,
    modalities,
    settings: {
      cache_ttl_ms: 30 * 60 * 1000,
      concurrency: 3,
      per_call_timeout_ms: 30_000,
      toast_on_missing_fallback: true,
    },
  };
}

function emptyModality(enabled = true): ModalityConfig {
  return { enabled, providerID: null, modelID: null, prompt: null };
}

export function normalizeConfig(input: unknown): PluginConfig {
  const out = defaultConfig();
  if (!input || typeof input !== "object") return out;
  const config = input as Partial<PluginConfig>;
  if (config.enabled === false) out.enabled = false;
  if (config.settings && typeof config.settings === "object") {
    const s = config.settings as Record<string, unknown>;
    out.settings.concurrency = int(s.concurrency, out.settings.concurrency, 1, 16);
    out.settings.per_call_timeout_ms = int(
      s.per_call_timeout_ms,
      out.settings.per_call_timeout_ms,
      1000,
      300000,
    );
    out.settings.cache_ttl_ms = int(s.cache_ttl_ms, out.settings.cache_ttl_ms, 0, 86400000);
    if (typeof s.toast_on_missing_fallback === "boolean")
      out.settings.toast_on_missing_fallback = s.toast_on_missing_fallback;
  }
  if (config.modalities && typeof config.modalities === "object") {
    for (const key of Object.keys(config.modalities)) {
      if (!isModality(key)) continue;
      const incoming = (config.modalities as Record<string, unknown>)[key];
      if (!incoming || typeof incoming !== "object") continue;
      const m = incoming as Record<string, unknown>;
      let providerID: string | null = null;
      let modelID: string | null = null;
      if (typeof m.providerID === "string") providerID = m.providerID;
      if (typeof m.modelID === "string") modelID = m.modelID;
      out.modalities[key] = {
        enabled: m.enabled !== false,
        providerID,
        modelID,
        prompt: typeof m.prompt === "string" ? m.prompt : null,
      };
    }
  }
  return out;
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

export function readConfig(filePath: string = pluginConfigPath()): PluginConfig {
  try {
    return normalizeConfig(JSON.parse(fsSync.readFileSync(filePath, "utf8")));
  } catch {
    return defaultConfig();
  }
}

export function writeConfig(config: PluginConfig, filePath: string = pluginConfigPath()): void {
  fsSync.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fsSync.writeFileSync(tmp, JSON.stringify(config, null, 2));
  fsSync.renameSync(tmp, filePath);
}

export function isModalityActive(config: PluginConfig, modality: Modality): boolean {
  return Boolean(
    config.enabled &&
    config.modalities[modality]?.enabled &&
    config.modalities[modality]?.providerID,
  );
}
