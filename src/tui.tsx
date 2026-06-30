/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui";

import { listCredentialedProviders } from "./auth.js";
import {
  defaultConfig,
  normalizeConfig,
  readConfig,
  writeConfig,
  resolvePluginConfigPathOption,
} from "./config.js";
import {
  getModel,
  listProviderModels,
  listProviders,
  mergeProviderConfigModels,
  providerConfigFromOpencodeConfig,
  modelDisplayName,
  modelSupportsModality,
  providerDisplayName,
  resolveModelsData,
} from "./models.js";
import { isSupportedProviderPackage } from "./describe.js";
import { DEFAULT_PROMPTS } from "./prompts.js";
import {
  HANDLED_MODALITIES,
  type Modality,
  type ModelEntry,
  type ModelsData,
  type PluginConfig,
  type ProviderEntry,
} from "./types.js";
import { clamp, isNonEmpty } from "./util.js";

type Ctx = {
  api: TuiPluginApi;
  config: PluginConfig;
  configPath?: string;
  data: ModelsData;
  credentialed: Set<string>;
};
type TuiOptions = { enabled?: boolean; config_path?: string };
type SelectOption = {
  title: string;
  value: string;
  description?: string;
  category?: string;
  disabled?: boolean;
};

function loadCtx(api: TuiPluginApi, data: ModelsData, configPath?: string): Ctx {
  const pc = providerConfigFromOpencodeConfig(api.state.config);
  return {
    api,
    config: readConfig(configPath),
    configPath,
    data: mergeProviderConfigModels(data, pc),
    credentialed: listCredentialedProviders(data, { providerConfig: pc }),
  };
}

function persist(ctx: Ctx): void {
  writeConfig(ctx.config, ctx.configPath);
}

function toast(
  ctx: Ctx,
  message: string,
  variant: "info" | "success" | "warning" | "error" = "info",
): void {
  try {
    ctx.api.ui.toast({ title: "opencode-fallback", message, variant });
  } catch {
    /* best-effort */
  }
}

function modelName(ctx: Ctx, providerID: string, modelID: string): string {
  const model = getModel(ctx.data, providerID, modelID);
  const provider = ctx.data[providerID];
  return `${provider ? providerDisplayName(provider) : providerID} / ${model ? modelDisplayName(model) : modelID}`;
}

// ---- Overview ----

function openMain(ctx: Ctx): void {
  const api = ctx.api;
  const DialogSelect = api.ui.DialogSelect;
  const config = ctx.config;
  const options: SelectOption[] = [];

  options.push({
    title: `Plugin enabled: ${config.enabled ? "on" : "off"}`,
    value: "__master",
    description: "Master switch — attachments routed to fallback when on",
    category: "General",
  });

  for (const modality of HANDLED_MODALITIES) {
    const entry = config.modalities[modality];
    const state = !entry.enabled ? "off" : !entry.providerID ? "no model" : "on";
    const desc =
      entry.providerID && entry.modelID
        ? modelName(ctx, entry.providerID, entry.modelID)
        : "No model configured";
    options.push({
      title: `${modality.toUpperCase().padEnd(5)}  [${state}]`,
      value: `modality:${modality}`,
      description: desc,
      category: "Modalities",
    });
  }

  options.push({
    title: "Settings…",
    value: "__settings",
    description: "Concurrency, timeout, cache TTL, toast",
    category: "General",
  });
  options.push({ title: "Done", value: "__done", description: "Save and close" });

  api.ui.dialog.setSize("large");
  api.ui.dialog.replace(() => (
    <DialogSelect
      title="Fallback — Configure settings"
      options={options}
      placeholder="Nothing ships by default. Pick a modality to add a fallback model."
      onSelect={(option) => {
        const value = (option as SelectOption).value;
        if (value === "__master") {
          config.enabled = !config.enabled;
          persist(ctx);
          openMain(ctx);
        } else if (value === "__settings") {
          openSettings(ctx);
        } else if (value === "__done") {
          persist(ctx);
          api.ui.dialog.clear();
          toast(ctx, "Configuration saved", "success");
        } else if (value.startsWith("modality:")) {
          openModality(ctx, value.slice("modality:".length) as Modality);
        }
      }}
    />
  ));
}

// ---- Per-modality editor ----

function openModality(ctx: Ctx, modality: Modality): void {
  const api = ctx.api;
  const DialogSelect = api.ui.DialogSelect;
  const entry = ctx.config.modalities[modality];
  const options: SelectOption[] = [];
  const configured = entry.providerID && entry.modelID;

  options.push({
    title: `Modality enabled: ${entry.enabled ? "on" : "off"}`,
    value: "__toggle",
    description: "When off, this modality is ignored",
  });
  options.push({
    title: configured
      ? `Model: ${modelName(ctx, entry.providerID!, entry.modelID!)}`
      : "Add model…",
    value: "__add",
    description: configured
      ? `${ctx.credentialed.has(entry.providerID!) ? "✓ credentialed" : "⚠ no key"} · pick a different model`
      : "Pick a provider, then a model",
  });
  if (configured) {
    options.push({
      title: "Remove model",
      value: "__remove",
      description: `Stop using ${modelName(ctx, entry.providerID!, entry.modelID!)}`,
    });
  }
  options.push({
    title: "Edit analysis prompt…",
    value: "__prompt",
    description: entry.prompt
      ? `Custom: ${entry.prompt.slice(0, 60)}…`
      : "Using the built-in default prompt",
  });
  options.push({ title: "← Back to overview", value: "__back" });

  api.ui.dialog.setSize("large");
  api.ui.dialog.replace(() => (
    <DialogSelect
      title={`${modality.toUpperCase()} fallback`}
      options={options}
      onSelect={(option) => {
        const value = (option as SelectOption).value;
        if (value === "__toggle") {
          entry.enabled = !entry.enabled;
          persist(ctx);
          openModality(ctx, modality);
        } else if (value === "__add") {
          openAddProvider(ctx, modality);
        } else if (value === "__remove") {
          entry.providerID = null;
          entry.modelID = null;
          persist(ctx);
          openModality(ctx, modality);
        } else if (value === "__prompt") {
          openEditPrompt(ctx, modality);
        } else if (value === "__back") {
          openMain(ctx);
        }
      }}
    />
  ));
}

// ---- Add flow ----

function openAddProvider(ctx: Ctx, modality: Modality): void {
  const api = ctx.api;
  const DialogSelect = api.ui.DialogSelect;
  const providers = listProviders(ctx.data)
    .filter(
      (p) =>
        p.id && p.models && isSupportedProviderPackage(p.npm) && hasModelForModality(p, modality),
    )
    .sort((a, b) => {
      const ac = ctx.credentialed.has(a.id) ? 0 : 1;
      const bc = ctx.credentialed.has(b.id) ? 0 : 1;
      if (ac !== bc) return ac - bc;
      return providerDisplayName(a).localeCompare(providerDisplayName(b));
    });

  const options: SelectOption[] = providers.map((p) => ({
    title: providerDisplayName(p),
    value: p.id,
    description: `${ctx.credentialed.has(p.id) ? "✓ credentialed" : "⚠ no key"} · ${p.npm ?? "no npm package"}`,
    category: ctx.credentialed.has(p.id) ? "Credentialed" : "No key set",
  }));
  options.push({ title: "← Back", value: "__back" });

  api.ui.dialog.setSize("large");
  api.ui.dialog.replace(() => (
    <DialogSelect
      title={`Pick a provider for ${modality.toUpperCase()}`}
      options={options}
      placeholder="Credentialed providers are listed first."
      onSelect={(option) => {
        const value = (option as SelectOption).value;
        if (value === "__back") openModality(ctx, modality);
        else openAddModel(ctx, modality, value);
      }}
    />
  ));
}

function openAddModel(ctx: Ctx, modality: Modality, providerID: string): void {
  const api = ctx.api;
  const DialogSelect = api.ui.DialogSelect;
  const models = listProviderModels(ctx.data, providerID)
    .filter((m) => modelSupportsModality(m, modality))
    .sort((a, b) => costOf(a) - costOf(b) || ctxSize(b) - ctxSize(a));

  const options: SelectOption[] = models.map((m) => ({
    title: modelDisplayName(m),
    value: m.id,
    description: `${costDesc(m)} · ${ctxDesc(m)}`,
  }));
  options.push({ title: "← Back", value: "__back" });

  api.ui.dialog.setSize("large");
  api.ui.dialog.replace(() => (
    <DialogSelect
      title={`Pick a model — ${providerDisplayName(ctx.data[providerID]!)} / ${modality.toUpperCase()}`}
      options={options}
      placeholder="Sorted by cheapest input cost."
      onSelect={(option) => {
        const value = (option as SelectOption).value;
        if (value === "__back") {
          openAddProvider(ctx, modality);
          return;
        }
        ctx.config.modalities[modality].providerID = providerID;
        ctx.config.modalities[modality].modelID = value;
        persist(ctx);
        const m = getModel(ctx.data, providerID, value);
        toast(
          ctx,
          `Added ${providerDisplayName(ctx.data[providerID]!)} / ${m ? modelDisplayName(m) : value}`,
          "success",
        );
        openModality(ctx, modality);
      }}
    />
  ));
}

function openEditPrompt(ctx: Ctx, modality: Modality): void {
  const api = ctx.api;
  const entry = ctx.config.modalities[modality];
  const current = isNonEmpty(entry.prompt) ? entry.prompt : DEFAULT_PROMPTS[modality];

  api.ui.dialog.setSize("large");
  api.ui.dialog.replace(() => (
    <api.ui.DialogPrompt
      title={`Analysis prompt — ${modality.toUpperCase()}`}
      value={current}
      onConfirm={(value) => {
        const trimmed = value.trim();
        entry.prompt = trimmed && trimmed !== DEFAULT_PROMPTS[modality] ? trimmed : null;
        persist(ctx);
        openModality(ctx, modality);
      }}
      onCancel={() => openModality(ctx, modality)}
    />
  ));
}

// ---- Settings ----

function openSettings(ctx: Ctx): void {
  const api = ctx.api;
  const s = ctx.config.settings;
  const opts: SelectOption[] = [
    {
      title: `Concurrency: ${s.concurrency}`,
      value: "concurrency",
      description: "Max parallel fallback calls per turn",
    },
    {
      title: `Per-call timeout: ${s.per_call_timeout_ms} ms`,
      value: "per_call_timeout_ms",
      description: "Abort a single fallback call after this many ms",
    },
    {
      title: `Cache TTL: ${Math.round(s.cache_ttl_ms / 60000)} min`,
      value: "cache_ttl_ms",
      description: "How long analysed attachments are reused",
    },
    {
      title: `Toast on missing fallback: ${s.toast_on_missing_fallback ? "on" : "off"}`,
      value: "toast",
      description: "Warn when no credentialed fallback resolves",
    },
    { title: "← Back to overview", value: "back" },
  ];

  api.ui.dialog.setSize("medium");
  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect
      title="Fallback settings"
      options={opts}
      onSelect={(option) => {
        const v = (option as SelectOption).value;
        if (v === "back") openMain(ctx);
        else if (v === "toast") {
          s.toast_on_missing_fallback = !s.toast_on_missing_fallback;
          persist(ctx);
          openSettings(ctx);
        } else
          editNumber(
            ctx,
            v as keyof Pick<typeof s, "concurrency" | "per_call_timeout_ms" | "cache_ttl_ms">,
          );
      }}
    />
  ));
}

function editNumber(ctx: Ctx, field: "concurrency" | "per_call_timeout_ms" | "cache_ttl_ms"): void {
  const api = ctx.api;
  const s = ctx.config.settings;
  const bounds = {
    concurrency: { min: 1, max: 16, label: "Concurrency (1-16)" },
    per_call_timeout_ms: { min: 1000, max: 300000, label: "Per-call timeout in ms (1000-300000)" },
    cache_ttl_ms: { min: 0, max: 86400000, label: "Cache TTL in ms (0 to disable)" },
  }[field];

  api.ui.dialog.setSize("medium");
  api.ui.dialog.replace(() => (
    <api.ui.DialogPrompt
      title={bounds.label}
      value={String(s[field])}
      onConfirm={(value) => {
        const p = Number(value.trim());
        if (!Number.isFinite(p)) {
          toast(ctx, "Not a number", "error");
          openSettings(ctx);
          return;
        }
        s[field] = clamp(Math.round(p), bounds.min, bounds.max);
        persist(ctx);
        openSettings(ctx);
      }}
      onCancel={() => openSettings(ctx)}
    />
  ));
}

// ---- helpers ----

function hasModelForModality(provider: ProviderEntry, modality: Modality): boolean {
  return Object.values(provider.models ?? {}).some((m) => modelSupportsModality(m, modality));
}

function costOf(m: ModelEntry): number {
  const v = m.cost?.input;
  return typeof v === "number" && Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
}

function ctxSize(m: ModelEntry): number {
  const v = m.limit?.context;
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function costDesc(m: ModelEntry): string {
  const v = m.cost?.input;
  if (typeof v !== "number" || !Number.isFinite(v)) return "cost unknown";
  return v === 0 ? "free input" : `$${v}/M in`;
}

function ctxDesc(m: ModelEntry): string {
  const v = m.limit?.context;
  if (typeof v !== "number" || !Number.isFinite(v)) return "context unknown";
  return `${Math.round(v / 1000)}k ctx`;
}

// ---- Plugin entry ----

const CMD = "opencode-fallback:open";

async function openConfig(api: TuiPluginApi, configPath?: string): Promise<void> {
  const data = await resolveModelsData();
  if (!data) {
    api.ui.dialog.setSize("medium");
    api.ui.dialog.replace(() => (
      <api.ui.DialogAlert
        title="Fallback unavailable"
        message="Could not load opencode's models.json cache. Start opencode once to populate it, then reopen /fallback."
        onConfirm={() => api.ui.dialog.clear()}
      />
    ));
    return;
  }
  const ctx = loadCtx(api, data, configPath);
  if (Object.keys(ctx.config.modalities).length === 0)
    ctx.config = normalizeConfig(defaultConfig());
  openMain(ctx);
}

const tui: TuiPlugin = async (api, rawOptions) => {
  const options = (rawOptions ?? {}) as TuiOptions;
  if (options?.enabled === false) return;
  const configPath = resolvePluginConfigPathOption(options.config_path);
  api.keymap.registerLayer({
    commands: [
      {
        name: CMD,
        title: "Fallback: Configure settings",
        description: "Configure multimodal image / pdf / audio fallback settings",
        category: "Fallback",
        namespace: "palette",
        slashName: "fallback",
        run: () => openConfig(api, configPath),
      },
    ],
  });
};

const plugin: TuiPluginModule = { id: "opencode-fallback", tui };
export default plugin;
export { tui };
