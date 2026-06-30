import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  decodeDataUrl,
  errorMessage,
  hashPart,
  isNonEmpty,
  mimeToModality,
  readAttachment,
} from "../src/util";

let dir: string | undefined;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("mimeToModality", () => {
  it("maps prefixes", () => {
    expect(mimeToModality("image/png")).toBe("image");
    expect(mimeToModality("application/pdf")).toBe("pdf");
    expect(mimeToModality("audio/mpeg")).toBe("audio");
    expect(mimeToModality("video/mp4")).toBe("video");
    expect(mimeToModality("text/plain")).toBeUndefined();
    expect(mimeToModality(undefined)).toBeUndefined();
  });
});

describe("decodeDataUrl", () => {
  it("decodes base64", () => {
    const r = decodeDataUrl("data:image/png;base64,iVBORw0KGgo=");
    expect(r?.mediaType).toBe("image/png");
    expect(r?.data.length).toBeGreaterThan(0);
  });

  it("rejects oversized", () => {
    expect(decodeDataUrl("data:text/plain;base64,aGVsbG8=", 2)).toBeNull();
  });

  it("rejects non-data urls", () => {
    expect(decodeDataUrl("file:///tmp/x.png")).toBeNull();
  });
});

describe("readAttachment", () => {
  it("reads file URLs", async () => {
    dir = mkdtempSync(join(tmpdir(), "fb-util-"));
    const f = join(dir, "sample.txt");
    writeFileSync(f, "hello");
    const r = await readAttachment(pathToFileURL(f).toString(), "text/plain");
    expect(r?.mediaType).toBe("text/plain");
    expect(Buffer.from(r?.data ?? []).toString("utf8")).toBe("hello");
  });

  it("rejects directories and oversized files", async () => {
    dir = mkdtempSync(join(tmpdir(), "fb-util-"));
    const f = join(dir, "sample.txt");
    writeFileSync(f, "hello");
    expect(await readAttachment(f, "text/plain")).toBeNull();
    expect(await readAttachment(pathToFileURL(dir).toString(), "text/plain")).toBeNull();
    expect(await readAttachment(pathToFileURL(f).toString(), "text/plain", 2)).toBeNull();
  });
});

describe("hashPart", () => {
  it("distinguishes mime and url", () => {
    expect(hashPart("image/png", "u1")).not.toBe(hashPart("image/jpeg", "u1"));
    expect(hashPart("image/png", "u1")).not.toBe(hashPart("image/png", "u2"));
  });
});

describe("isNonEmpty", () => {
  it("rejects blanks", () => {
    expect(isNonEmpty("")).toBe(false);
    expect(isNonEmpty("   ")).toBe(false);
    expect(isNonEmpty(null)).toBe(false);
    expect(isNonEmpty("x")).toBe(true);
  });
});

describe("errorMessage", () => {
  it("redacts secrets", () => {
    const msg = errorMessage("Bearer abcdef123456, apiKey: sk-test12345678");
    expect(msg).toContain("[redacted]");
    expect(msg).not.toContain("abcdef123456");
    expect(msg).not.toContain("sk-test");
  });
});
