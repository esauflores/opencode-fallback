import { describe, expect, it } from "vitest";
import {
  distinctModalities,
  findUnsupportedAttachments,
  isFilePart,
  replaceWithText,
  type MessageContainer,
} from "../src/parts";
import type { Modality, SelectedFallback } from "../src/types";

function filePart(id: string, mime: string, url: string, filename?: string) {
  return {
    id,
    sessionID: "s1",
    messageID: "m1",
    type: "file" as const,
    mime,
    url,
    ...(filename ? { filename } : {}),
  };
}

describe("isFilePart", () => {
  it("detects file parts", () => {
    expect(isFilePart({ type: "file", url: "data:..." })).toBe(true);
    expect(isFilePart({ type: "text", text: "hi" })).toBe(false);
    expect(isFilePart(null)).toBe(false);
  });
});

describe("findUnsupportedAttachments", () => {
  it("finds image and pdf parts", () => {
    const msgs: MessageContainer[] = [
      {
        info: { sessionID: "s1", role: "user" },
        parts: [
          filePart("p1", "image/png", "data:image/png;base64,AAAA"),
          filePart("p2", "application/pdf", "data:application/pdf;base64,BBBB"),
          filePart("p3", "text/plain", "data:text/plain;base64,CCCC"),
        ],
      },
    ];
    const hits = findUnsupportedAttachments(msgs, new Set<Modality>(["image", "pdf"]));
    expect(hits.length).toBe(2);
    expect(distinctModalities(hits)).toEqual(new Set(["image", "pdf"]));
  });

  it("skips non-matching modalities", () => {
    const msgs: MessageContainer[] = [
      {
        info: { sessionID: "s1", role: "user" },
        parts: [filePart("p1", "image/png", "data:...")],
      },
    ];
    expect(findUnsupportedAttachments(msgs, new Set<Modality>(["audio"])).length).toBe(0);
  });
});

describe("replaceWithText", () => {
  it("replaces file parts with synthetic text", () => {
    const msgs: MessageContainer[] = [
      {
        info: { sessionID: "s1", role: "user" },
        parts: [
          { type: "text", text: "what is this?" },
          filePart("p1", "image/png", "data:...", "shot.png"),
        ],
      },
    ];
    const hits = findUnsupportedAttachments(msgs, new Set<Modality>(["image"]));
    const fb: SelectedFallback = {
      providerID: "openai",
      modelID: "gpt-4o",
      npm: "@ai-sdk/openai",
      env: [],
    };
    replaceWithText(
      msgs,
      hits,
      () => "a screenshot of a button",
      () => fb,
    );
    expect(msgs[0]!.parts[0]!.type).toBe("text");
    expect(msgs[0]!.parts[1]!.type).toBe("text");
    const text = (msgs[0]!.parts[1] as unknown as { text: string }).text;
    expect(text).toContain("a screenshot of a button");
    expect(text).toContain("openai/gpt-4o");
  });

  it("leaves parts without description untouched", () => {
    const msgs: MessageContainer[] = [
      {
        info: { sessionID: "s1", role: "user" },
        parts: [filePart("p1", "image/png", "data:...")],
      },
    ];
    const hits = findUnsupportedAttachments(msgs, new Set<Modality>(["image"]));
    replaceWithText(
      msgs,
      hits,
      () => undefined,
      () => ({ providerID: "o", modelID: "m", npm: "@ai-sdk/openai", env: [] }),
    );
    expect(msgs[0]!.parts[0]!.type).toBe("file");
  });
});
