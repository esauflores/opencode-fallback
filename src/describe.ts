import type { Modality, ResolvedKey, SelectedFallback } from "./types.js";
import { readAttachment, errorMessage } from "./util.js";

const FACTORIES: Record<string, string> = {
  "@ai-sdk/anthropic": "createAnthropic",
  "@ai-sdk/openai": "createOpenAI",
  "@ai-sdk/openai-compatible": "createOpenAICompatible",
  "@ai-sdk/google": "createGoogleGenerativeAI",
  "@ai-sdk/google-vertex": "createVertex",
  "@ai-sdk/mistral": "createMistral",
  "@ai-sdk/cohere": "createCohere",
  "@ai-sdk/groq": "createGroq",
  "@ai-sdk/xai": "createXai",
  "@ai-sdk/amazon-bedrock": "createAmazonBedrock",
  "@ai-sdk/azure": "createAzure",
  "@ai-sdk/deepinfra": "createDeepInfra",
  "@ai-sdk/fireworks": "createFireworks",
  "@ai-sdk/togetherai": "createTogetherAI",
  "@ai-sdk/perplexity": "createPerplexity",
  "@openrouter/ai-sdk-provider": "createOpenRouter",
};

export function isSupportedProviderPackage(name: string | undefined): name is string {
  return Boolean(name && FACTORIES[name]);
}

export type DescribeArgs = {
  fallback: SelectedFallback;
  modality: Modality;
  mime: string;
  url: string;
  prompt: string;
  key: ResolvedKey;
  signal: AbortSignal;
};

export async function describe(args: DescribeArgs): Promise<string> {
  const { fallback, modality, mime, url, prompt, key, signal } = args;

  const mod = (await import(fallback.npm).catch((error) => {
    throw new Error(
      `provider package "${fallback.npm}" could not be loaded: ${errorMessage(error)}`,
    );
  })) as Record<string, unknown>;

  const factory = mod[FACTORIES[fallback.npm]!] ?? mod.default;
  if (typeof factory !== "function")
    throw new Error(`no provider factory found in ${fallback.npm}`);

  const provider = factory({ apiKey: key.key, ...(key.baseURL ? { baseURL: key.baseURL } : {}) });
  const model =
    typeof provider === "function" ? provider(fallback.modelID) : provider(fallback.modelID);
  if (!model)
    throw new Error(`provider ${fallback.npm} did not return a model for ${fallback.modelID}`);

  const ai = (await import("ai").catch((error) => {
    throw new Error(`the "ai" package is unavailable: ${errorMessage(error)}`);
  })) as { generateText: (opts: Record<string, unknown>) => Promise<{ text?: string }> };

  const attachment = await readAttachment(url, mime);
  if (!attachment) throw new Error("attachment could not be read (empty or unreadable)");

  const content: Array<Record<string, unknown>> = [{ type: "text" as const, text: prompt }];
  if (modality === "image") {
    content.push({ type: "image" as const, image: attachment.data });
  } else {
    const dataUrl = `data:${attachment.mediaType};base64,${Buffer.from(attachment.data).toString("base64")}`;
    content.push({ type: "image" as const, image: dataUrl, mediaType: attachment.mediaType });
  }

  const result = await ai.generateText({
    model,
    messages: [{ role: "user", content }],
    abortSignal: signal,
  });

  const text = (result?.text ?? "").trim();
  if (!text) throw new Error("fallback model returned empty text");
  return text;
}
