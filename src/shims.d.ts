// Shims for dynamically loaded packages that TypeScript cannot resolve.
declare module "ai" {
  export function generateText(options: {
    model?: unknown;
    messages?: unknown;
    abortSignal?: AbortSignal;
    [key: string]: unknown;
  }): Promise<{ text?: string; usage?: unknown }>;
}
