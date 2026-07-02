import type { Modality, SelectedFallback } from "./types.js";
import { mimeToModality } from "./util.js";

export type FilePart = {
  id: string;
  sessionID: string;
  messageID: string;
  type: "file";
  mime: string;
  filename?: string;
  url: string;
  source?: unknown;
};

type TextPart = {
  id?: string;
  sessionID?: string;
  messageID?: string;
  type: "text";
  text: string;
  synthetic?: boolean;
};

type AnyPart = Record<string, unknown> & { type: string };
export type MessageContainer = { info: { sessionID?: string; role?: string }; parts: AnyPart[] };

export type UnsupportedHit = {
  messageIdx: number;
  partIdx: number;
  part: FilePart;
  modality: Modality;
};

export function isFilePart(part: unknown): part is FilePart {
  if (!part || typeof part !== "object") return false;
  const v = part as Record<string, unknown>;
  return v.type === "file" && typeof v.url === "string";
}

export function findUnsupportedAttachments(
  messages: MessageContainer[],
  missing: Set<Modality>,
): UnsupportedHit[] {
  const hits: UnsupportedHit[] = [];
  messages.forEach((msg, mi) => {
    if (!Array.isArray(msg?.parts)) return;
    msg.parts.forEach((raw, pi) => {
      if (!isFilePart(raw)) return;
      const p = raw;
      if (!p.url) return;
      const modality = mimeToModality(p.mime);
      if (!modality || !missing.has(modality)) return;
      hits.push({ messageIdx: mi, partIdx: pi, part: p, modality });
    });
  });
  return hits;
}

export function distinctModalities(hits: UnsupportedHit[]): Set<Modality> {
  const out = new Set<Modality>();
  for (const h of hits) out.add(h.modality);
  return out;
}

export function replaceWithText(
  messages: MessageContainer[],
  hits: UnsupportedHit[],
  describeFor: (hit: UnsupportedHit) => string | undefined,
  fallbackFor: (modality: Modality) => SelectedFallback | undefined,
): void {
  for (const hit of hits) {
    const description = describeFor(hit);
    if (!description) continue;
    const fallback = fallbackFor(hit.modality);
    const header = fallback
      ? `[${hit.modality} analysed by ${fallback.providerID}/${fallback.modelID}]`
      : `[${hit.modality}]`;
    const source = hit.part.filename ? `source: ${hit.part.filename}` : "source: inline";
    const text = `${header}\n${description}\n(${source})`;
    const parts = messages[hit.messageIdx]?.parts;
    if (!parts) continue;
    const replacement: TextPart = {
      ...(parts[hit.partIdx] as object),
      type: "text",
      text,
      synthetic: true,
    };
    parts[hit.partIdx] = replacement as unknown as AnyPart;
  }
}
