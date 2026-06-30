import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { listCredentialedProviders, resolveKey } from "../src/auth";
import type { ModelsData } from "../src/types";

const fp = fileURLToPath(new URL("./fixtures/models.json", import.meta.url));
const ap = fileURLToPath(new URL("./fixtures/auth.json", import.meta.url));
const cap = fileURLToPath(new URL("./fixtures/auth-custom.json", import.meta.url));
let data: ModelsData;
let envBackup: string | undefined;
let awsBackup: string | undefined;

beforeEach(() => {
  data = JSON.parse(readFileSync(fp, "utf8")) as ModelsData;
  envBackup = process.env.NOKEY_API_KEY;
  awsBackup = process.env.AWS_SECRET_ACCESS_KEY;
});

afterEach(() => {
  if (envBackup === undefined) delete process.env.NOKEY_API_KEY;
  else process.env.NOKEY_API_KEY = envBackup;
  if (awsBackup === undefined) delete process.env.AWS_SECRET_ACCESS_KEY;
  else process.env.AWS_SECRET_ACCESS_KEY = awsBackup;
});

describe("resolveKey", () => {
  it("reads key from auth.json", () => {
    expect(resolveKey(data, "openai", { authPath: ap })).toEqual({ key: "openai-test-key" });
  });

  it("tolerates legacy apikey field", () => {
    expect(resolveKey(data, "anthropic", { authPath: ap })).toEqual({
      key: "anthropic-legacy-key",
    });
  });

  it("falls back to env", () => {
    process.env.NOKEY_API_KEY = "env-key";
    expect(resolveKey(data, "nokey", { authPath: ap })).toEqual({ key: "env-key" });
  });

  it("rejects unrelated env vars", () => {
    data.nokey!.env = ["AWS_SECRET_ACCESS_KEY"];
    process.env.AWS_SECRET_ACCESS_KEY = "do-not-read";
    expect(resolveKey(data, "nokey", { authPath: ap })).toBeNull();
  });

  it("returns null when no source resolves", () => {
    delete process.env.NOKEY_API_KEY;
    expect(resolveKey(data, "nokey", { authPath: ap })).toBeNull();
  });

  it("honours provider config apiKey + baseURL", () => {
    const r = resolveKey(data, "nokey", {
      authPath: ap,
      providerConfig: { nokey: { apiKey: "cfg-key", baseURL: "https://gw.example.com" } },
    });
    expect(r).toEqual({ key: "cfg-key", baseURL: "https://gw.example.com" });
  });
});

describe("listCredentialedProviders", () => {
  it("lists all resolvable", () => {
    process.env.NOKEY_API_KEY = "env-key";
    const s = listCredentialedProviders(data, { providerConfig: {}, authPath: ap });
    expect(s.has("openai")).toBe(true);
    expect(s.has("anthropic")).toBe(true);
    expect(s.has("nokey")).toBe(true);
  });

  it("lists custom providers from provider config", () => {
    const s = listCredentialedProviders(data, {
      providerConfig: { gateway: { apiKey: "cfg-key" } },
      authPath: ap,
    });
    expect(s.has("gateway")).toBe(true);
  });

  it("lists custom providers from auth.json", () => {
    const pc = {
      gateway: { baseURL: "https://gateway.example.com/v1", npm: "@ai-sdk/openai-compatible" },
    };
    const s = listCredentialedProviders(data, { authPath: cap, providerConfig: pc });
    expect(s.has("gateway")).toBe(true);
  });

  it("rejects blank keys", () => {
    const s = listCredentialedProviders(data, {
      providerConfig: { gateway: { apiKey: "  " } },
      authPath: ap,
    });
    expect(s.has("gateway")).toBe(false);
  });
});
