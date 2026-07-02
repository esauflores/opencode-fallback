import type { Hooks, Plugin, PluginInput, PluginOptions } from "@opencode-ai/plugin";
import { listCredentialedProviders, resolveKey } from "./auth.js";
import { isModalityActive, resolvePluginConfigPathOption, readConfig } from "./config.js";
import { describe } from "./describe.js";
import { mergeProviderConfigModels, providerConfigFromOpencodeConfig } from "./models.js";
import {
  getModel,
  modelSupportsModality,
  providerEnv,
  providerNpm,
  resolveModelsData,
  supportedInputModalities,
  DEFAULT_CUSTOM_PROVIDER_NPM,
} from "./models.js";
import {
  distinctModalities,
  findUnsupportedAttachments,
  replaceWithText,
  type MessageContainer,
} from "./parts.js";
import { DEFAULT_PROMPTS } from "./prompts.js";
import {
  HANDLED_MODALITIES,
  type Modality,
  type ModelsData,
  type ProviderConfigMap,
  type SelectedFallback,
} from "./types.js";
import { errorMessage, hashPart } from "./util.js";
import { isSupportedProviderPackage } from "./describe.js";

type ServerOptions = { log_level?: "debug" | "info" | "warn" | "error"; config_path?: string };
type ActiveModel = { providerID: string; modelID: string; resolvedAt: number };
type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

// ---- description cache (per-session, TTL-based) ----

class Cache {
  private map = new Map<string, { desc: string; exp: number }>();

  constructor(private ttlMs: number) {}

  get(hash: string): string | undefined {
    const e = this.map.get(hash);
    if (!e) return undefined;
    if (Date.now() > e.exp) {
      this.map.delete(hash);
      return undefined;
    }
    return e.desc;
  }

  set(hash: string, desc: string): void {
    this.map.set(hash, { desc, exp: Date.now() + this.ttlMs });
  }

  cleanup(): void {
    const now = Date.now();
    for (const [k, e] of this.map) if (now > e.exp) this.map.delete(k);
  }

  get size(): number {
    return this.map.size;
  }
}

// ---- concurrency limiter ----

function limiter(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const exec = async () => {
        active++;
        try {
          resolve(await fn());
        } catch (e) {
          reject(e);
        } finally {
          active--;
          drain();
        }
      };
      const drain = () => {
        while (active < max && queue.length) queue.shift()?.();
      };
      if (active < max) exec();
      else queue.push(exec);
    });
}

// ---- fallback selection ----

function selectFallback(
  data: ModelsData,
  config: { modalities: Record<string, { providerID: string | null; modelID: string | null }> },
  credentialed: Set<string>,
  modality: Modality,
  providerConfig?: ProviderConfigMap,
): SelectedFallback | null {
  const entry = config.modalities[modality];
  const providerID = entry?.providerID;
  const modelID = entry?.modelID;
  if (!providerID || !modelID) return null;
  if (!credentialed.has(providerID)) return null;

  const providerInData = data[providerID];
  const providerInConfig = providerConfig?.[providerID];
  const npm =
    providerNpm(data, providerID) ??
    providerInConfig?.npm ??
    (providerInConfig ? DEFAULT_CUSTOM_PROVIDER_NPM : undefined);
  if (!isSupportedProviderPackage(npm)) return null;

  if (providerInData) {
    const model = getModel(data, providerID, modelID);
    if (model && !modelSupportsModality(model, modality)) return null;
    if (!model && !providerInConfig) return null;
    return { providerID, modelID, npm, env: providerEnv(data, providerID) };
  }
  if (providerInConfig) return { providerID, modelID, npm, env: [] };
  return null;
}

// ---- plugin ----

const server: Plugin = async (input: PluginInput, rawOptions?: PluginOptions) => {
  const client = input.client;
  const options = (rawOptions ?? {}) as ServerOptions;
  const minLevel = LEVELS[options.log_level ?? "info"] ?? LEVELS.info;
  const configPath = resolvePluginConfigPathOption(options.config_path);

  let data: ModelsData | null = null;
  let providerConfig: ProviderConfigMap = {};
  const activeModels = new Map<string, ActiveModel>();
  const caches = new Map<string, Cache>();
  const toastShown = new Set<string>();

  const log = (level: LogLevel, message: string, extra?: Record<string, unknown>) => {
    if (LEVELS[level] < minLevel) return;
    try {
      client.app.log({ body: { service: "opencode-fallback", level, message, extra } } as any);
    } catch {
      /* ignore */
    }
  };

  const toast = (message: string, variant: "info" | "warning" | "error" = "info") => {
    try {
      client.tui.showToast({ body: { title: "opencode-fallback", message, variant } } as any);
    } catch {
      /* ignore */
    }
  };

  const getData = async (): Promise<ModelsData | null> => {
    if (data !== null) return data;
    data = await resolveModelsData();
    if (!data) log("warn", "models data unavailable; capability detection disabled");
    return data;
  };

  const getCatalog = async (): Promise<ModelsData | null> => {
    const d = await getData();
    return d ? mergeProviderConfigModels(d, providerConfig) : null;
  };

  const cacheFor = (sessionID: string, ttlMs: number): Cache => {
    let c = caches.get(sessionID);
    if (!c || c.size === 0) {
      c = new Cache(ttlMs);
      caches.set(sessionID, c);
    }
    return c;
  };

  const runTransform = async (messages: MessageContainer[]) => {
    const config = readConfig(configPath);
    if (!config.enabled) {
      log("debug", "plugin disabled; transform skipped");
      return;
    }

    const sessionID = messages[0]?.info?.sessionID;
    if (!sessionID) return;

    const active = activeModels.get(sessionID);
    if (!active) {
      log("debug", "no active model for session; transform skipped", { sessionID });
      return;
    }

    const modelsData = await getCatalog();
    if (!modelsData) return;

    const supported = supportedInputModalities(modelsData, active.providerID, active.modelID);
    const missing = new Set<Modality>();
    for (const m of HANDLED_MODALITIES) {
      if (isModalityActive(config, m) && !supported.has(m)) missing.add(m);
    }
    if (missing.size === 0) return;

    const hits = findUnsupportedAttachments(messages, missing);
    if (hits.length === 0) return;

    const credentialed = listCredentialedProviders(modelsData, { providerConfig });
    const plan = new Map<Modality, SelectedFallback>();
    const unresolved = new Set<Modality>();

    for (const m of distinctModalities(hits)) {
      const fb = selectFallback(modelsData, config, credentialed, m, providerConfig);
      if (fb) plan.set(m, fb);
      else unresolved.add(m);
    }

    if (unresolved.size > 0) {
      const list = [...unresolved].join(", ");
      log("warn", `no credentialed fallback for modalities: ${list}`);
      if (config.settings.toast_on_missing_fallback) {
        const key = `${sessionID}:${list}`;
        if (!toastShown.has(key)) {
          toastShown.add(key);
          toast(`No credentialed fallback model for ${list}. Configure with /fallback.`, "warning");
        }
      }
    }

    if (plan.size === 0) return;

    const cache = cacheFor(sessionID, config.settings.cache_ttl_ms);
    const descriptions = new Map<string, string>();
    const tasks: Array<Promise<void>> = [];
    const limit = limiter(Math.max(1, config.settings.concurrency));

    const uncached = hits.filter(
      (h) => plan.has(h.modality) && !cache.get(hashPart(h.part.mime, h.part.url)),
    );
    if (uncached.length > 0) {
      const labels = [...new Set(uncached.map((h) => h.modality))].join(", ");
      toast(
        `Analyzing ${uncached.length} ${uncached.length === 1 ? "attachment" : "attachments"} (${labels})...`,
        "info",
      );
    }

    for (const hit of hits) {
      const fb = plan.get(hit.modality);
      if (!fb) continue;
      const key = hashPart(hit.part.mime, hit.part.url);
      const cached = cache.get(key);
      if (cached) {
        descriptions.set(key, cached);
        continue;
      }
      const resolvedKey = resolveKey(modelsData, fb.providerID, { providerConfig });
      if (!resolvedKey) {
        const err = `no API key configured for ${fb.providerID}`;
        descriptions.set(key, `[${hit.modality} analysis failed: ${err}]`);
        log("warn", `${hit.modality} ${err}`);
        continue;
      }
      const userTexts = (messages[hit.messageIdx]?.parts ?? [])
        .filter((p: any) => p.type === "text" && typeof p.text === "string")
        .map((p: any) => p.text)
        .join("\n");
      const basePrompt = config.modalities[hit.modality]?.prompt || DEFAULT_PROMPTS[hit.modality];
      const prompt = userTexts
        ? `${basePrompt}\n\nThe user's query about this file:\n${userTexts}`
        : basePrompt;
      tasks.push(
        limit(async () => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), config.settings.per_call_timeout_ms);
          try {
            const text = await describe({
              fallback: fb,
              modality: hit.modality,
              mime: hit.part.mime,
              url: hit.part.url,
              prompt,
              key: resolvedKey,
              signal: controller.signal,
            });
            cache.set(key, text);
            descriptions.set(key, text);
            log("debug", `${hit.modality} analysed`, {
              provider: fb.providerID,
              model: fb.modelID,
              source: hit.part.filename || "inline",
            });
          } catch (error) {
            const err = errorMessage(error);
            descriptions.set(key, `[${hit.modality} analysis failed: ${err}]`);
            log("warn", `${hit.modality} describe failed: ${err}`);
          } finally {
            clearTimeout(timer);
          }
        }),
      );
    }

    if (tasks.length > 0) await Promise.all(tasks);
    cache.cleanup();

    replaceWithText(
      messages,
      hits,
      (hit) => descriptions.get(hashPart(hit.part.mime, hit.part.url)),
      (m) => plan.get(m),
    );
  };

  const hooks: Hooks = {
    config: (cfg) => {
      providerConfig = providerConfigFromOpencodeConfig(cfg);
      log("debug", "config loaded", { providers: Object.keys(providerConfig).length });
      return Promise.resolve();
    },
    "chat.message": (input) => {
      if (input.model?.providerID && input.model?.modelID) {
        activeModels.set(input.sessionID, {
          providerID: input.model.providerID,
          modelID: input.model.modelID,
          resolvedAt: Date.now(),
        });
      }
      return Promise.resolve();
    },
    "chat.params": (input) => {
      if (input.model?.id) {
        const [providerID, modelID] = String(input.model.id).split("/");
        if (providerID && modelID)
          activeModels.set(input.sessionID, { providerID, modelID, resolvedAt: Date.now() });
      }
      return Promise.resolve();
    },
    "experimental.chat.messages.transform": (_input, output) => {
      const model = (_input as { model?: { providerID?: string; modelID?: string } })?.model;
      if (model?.providerID && model?.modelID) {
        const sid = (output.messages as unknown as MessageContainer[])?.[0]?.info?.sessionID;
        if (sid)
          activeModels.set(sid, {
            providerID: model.providerID,
            modelID: model.modelID,
            resolvedAt: Date.now(),
          });
      }
      return runTransform(output.messages as unknown as MessageContainer[]);
    },
    event: (input) => {
      const event = input.event as { type?: string; properties?: { id?: string } };
      if (event.type === "session.deleted" && event.properties?.id) {
        const id = event.properties.id;
        activeModels.delete(id);
        caches.delete(id);
        for (const k of toastShown) if (k.startsWith(`${id}:`)) toastShown.delete(k);
      }
      return Promise.resolve();
    },
  };

  log("info", "plugin loaded; configure fallbacks with /fallback");
  return hooks;
};

const plugin = { id: "opencode-fallback", server };
export default plugin;
export { server };
