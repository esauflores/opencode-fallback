import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ModelsData, ProviderConfigMap, ResolvedKey } from "./types.js";
import { isNonEmpty } from "./util.js";

// ---- paths ----

function dataDir(): string {
  const d = process.env.XDG_DATA_HOME;
  return path.join(d && d.trim() ? d : path.join(os.homedir(), ".local", "share"), "opencode");
}

function authJsonPath(): string {
  return path.join(dataDir(), "auth.json");
}

// ---- auth ----

type AuthEntry = Record<string, unknown> & {
  key?: string;
  apikey?: string;
  apiKey?: string;
  baseURL?: string;
};

function readAuthJson(ap: string): Record<string, AuthEntry> {
  try {
    const data = JSON.parse(fsSync.readFileSync(ap, "utf8"));
    return data && typeof data === "object" ? (data as Record<string, AuthEntry>) : {};
  } catch {
    return {};
  }
}

export function resolveKey(
  data: ModelsData,
  providerID: string,
  opts: { providerConfig?: ProviderConfigMap; authPath?: string } = {},
): ResolvedKey | null {
  const cfgBaseURL = opts.providerConfig?.[providerID]?.baseURL;
  const auth = readAuthJson(opts.authPath ?? authJsonPath());
  const entry = auth[providerID];

  // 1. auth.json
  if (entry && typeof entry === "object") {
    const key = entry.key ?? entry.apikey ?? entry.apiKey;
    if (isNonEmpty(key)) return cfgBaseURL ? { key, baseURL: cfgBaseURL } : { key };
  }

  // 2. provider config apiKey
  const cfgKey = opts.providerConfig?.[providerID]?.apiKey;
  if (isNonEmpty(cfgKey))
    return cfgBaseURL ? { key: cfgKey, baseURL: cfgBaseURL } : { key: cfgKey };

  // 3. env vars
  const provider = data[providerID];
  for (const name of provider?.env ?? []) {
    if (!/^[A-Z0-9_]+$/.test(name)) continue;
    // ponytail: env allowlist check inline — only allow known vars or provider-prefixed ones
    const npm = provider?.npm;
    const allowlist: Record<string, readonly string[]> = {
      "@ai-sdk/anthropic": ["ANTHROPIC_API_KEY"],
      "@ai-sdk/openai": ["OPENAI_API_KEY"],
      "@ai-sdk/openai-compatible": ["OPENAI_COMPATIBLE_API_KEY"],
      "@ai-sdk/google": ["GOOGLE_GENERATIVE_AI_API_KEY", "GOOGLE_API_KEY", "GEMINI_API_KEY"],
      "@ai-sdk/google-vertex": ["GOOGLE_VERTEX_API_KEY"],
      "@ai-sdk/mistral": ["MISTRAL_API_KEY"],
      "@ai-sdk/cohere": ["COHERE_API_KEY"],
      "@ai-sdk/groq": ["GROQ_API_KEY"],
      "@ai-sdk/xai": ["XAI_API_KEY"],
      "@ai-sdk/amazon-bedrock": ["AWS_BEDROCK_API_KEY"],
      "@ai-sdk/azure": ["AZURE_API_KEY", "AZURE_OPENAI_API_KEY"],
      "@ai-sdk/deepinfra": ["DEEPINFRA_API_KEY"],
      "@ai-sdk/fireworks": ["FIREWORKS_API_KEY"],
      "@ai-sdk/togetherai": ["TOGETHER_API_KEY", "TOGETHERAI_API_KEY"],
      "@ai-sdk/perplexity": ["PERPLEXITY_API_KEY"],
      "@openrouter/ai-sdk-provider": ["OPENROUTER_API_KEY"],
    };
    const allowed = npm ? allowlist[npm]?.includes(name) : false;
    const prefixOk = providerID.replace(/[^a-zA-Z0-9]+/g, "_").toUpperCase();
    if (!allowed && (!prefixOk || !name.startsWith(`${prefixOk}_`) || !name.endsWith("_API_KEY")))
      continue;
    const value = process.env[name];
    if (isNonEmpty(value)) return cfgBaseURL ? { key: value, baseURL: cfgBaseURL } : { key: value };
  }

  return null;
}

export function listCredentialedProviders(
  data: ModelsData,
  opts: { providerConfig?: ProviderConfigMap; authPath?: string } = {},
): Set<string> {
  const out = new Set<string>();
  for (const providerID of new Set([
    ...Object.keys(data),
    ...Object.keys(opts.providerConfig ?? {}),
  ])) {
    if (resolveKey(data, providerID, opts)) out.add(providerID);
  }
  return out;
}
