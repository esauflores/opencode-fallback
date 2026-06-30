import { describe, expect, it } from "vitest";
import { isSupportedProviderPackage } from "../src/describe";

describe("isSupportedProviderPackage", () => {
  it("recognises bundled packages", () => {
    expect(isSupportedProviderPackage("@ai-sdk/openai")).toBe(true);
    expect(isSupportedProviderPackage("@ai-sdk/anthropic")).toBe(true);
    expect(isSupportedProviderPackage("@openrouter/ai-sdk-provider")).toBe(true);
  });

  it("rejects unknown packages", () => {
    expect(isSupportedProviderPackage("@ai-sdk/unknown")).toBe(false);
    expect(isSupportedProviderPackage(undefined)).toBe(false);
    expect(isSupportedProviderPackage("")).toBe(false);
  });
});
