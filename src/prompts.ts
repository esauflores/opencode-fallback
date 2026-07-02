import type { Modality } from "./types.js";

export const DEFAULT_PROMPTS: Record<Modality, string> = {
  image: [
    "You describe images to a coding agent. The user's question is prepended above — answer what they asked.",
    "Cover: UI layout (buttons, inputs, nav), quoted text (verbatim), code snippets, error messages, URLs, version numbers, colors, and icons.",
    "Use markdown for structure. Be thorough but concise.",
  ].join("\n"),
  pdf: [
    "You extract document content for a coding agent. The user's question is prepended above — answer what they asked.",
    "Extract: section headings, body text, code blocks as ``` fences, tables as markdown, key values, and diagram meanings.",
    "Preserve ordering. Be thorough but concise.",
  ].join("\n"),
  audio: [
    "You transcribe audio for a coding agent. The user's question is prepended above.",
    "Transcribe speech verbatim. Mark speakers when discernible. Briefly note non-speech events (music, alerts, tones).",
    "Be thorough but concise.",
  ].join("\n"),
  video: [
    "You describe video content to a coding agent. The user's question is prepended above — answer what they asked.",
    "Cover: key frames, on-screen text, UI interactions, visible code, actions performed, and spoken audio.",
    "Be thorough but concise.",
  ].join("\n"),
};
