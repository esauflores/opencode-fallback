# Project Guide

## Package Manager

- Use Bun for installs, scripts, and lockfile management.
- Do not add npm, pnpm, or yarn lockfiles. Root lockfile should be `bun.lock`.
- Run `bun install` after dependency changes. Prefer `bun install --frozen-lockfile` in CI.

## Commands

| Task | Command |
|------|---------|
| Install | `bun install` |
| Build | `bun run build` |
| Watch | `bun run dev` |
| Typecheck | `bun run typecheck` |
| Tests | `bun run test` |
| Tests watch | `bun run test:watch` |
| Lint/format | `bun run format` |
| Dead code | `bun run knip` |

Run `bun run build && bun run typecheck && bun run test && bun run format` before considering work done.

## Architecture

This package is an opencode plugin named `opencode-fallback`. It provides multimodal fallback: when the user's active model can't read images, PDFs, audio, or video, a separate fallback model describes the content and the description is injected as text into the chat.

Two plugin targets exposed through `package.json` exports:
- `./server` → `dist/server.js`, built from `src/server.ts`.
- `./tui` → `src/tui.tsx`, loaded by opencode TUI runtime as raw TSX.

Flat `src/` directory — no subdirectories. Each file is a single concern.

### Source files

| File | Role |
|------|------|
| `types.ts` | Shared types: `Modality`, `ModalityConfig`, `PluginConfig`, `SelectedFallback`, provider/model entry shapes |
| `util.ts` | MIME-to-modality mapping, base64 decoding, file:// attachment reader, hash, secret redaction |
| `config.ts` | Plugin config read/write/normalize, XDG paths, `isModalityActive` guard |
| `auth.ts` | API key resolution chain: auth.json → provider config → env vars (with allowlist) |
| `models.ts` | Load/merge/fetch models.json catalog, capability lookups, opencode config → provider config |
| `describe.ts` | Dynamic import of provider package + `ai.generateText` to describe an attachment |
| `parts.ts` | Scan messages for unsupported file parts, replace with synthetic text descriptions |
| `prompts.ts` | Default analysis prompts per modality |
| `server.ts` | Plugin entry: hooks for `chat.message`, `chat.params`, `experimental.chat.messages.transform`, `config`, `event`. Orchestrates cache, concurrency limiter, fallback selection, transform pipeline |
| `tui.tsx` | `/fallback` interactive config UI: pick providers/models per modality, edit prompts and settings |

### Dev workflow

- `src/tui.tsx` is loaded directly by opencode — no build step needed for TUI changes. Restart opencode to pick up edits.
- `src/server.ts` must be built with `bun run build` (or `bun run dev` for watch mode). opencode loads from `dist/server.js`.
- `.opencode/opencode.json` and `.opencode/tui.json` self-load the plugin from `"plugin": [".."]` for local development.
- If `.opencode/*` config changes, restart opencode. Config is loaded at startup.

### Data flow

1. opencode sends `chat.message` or `chat.params` hook → plugin records the active model.
2. On `experimental.chat.messages.transform`, the plugin checks which modalities the active model can't handle.
3. For each unsupported attachment, it resolves a fallback model from user config, resolves API keys via `auth.ts`, calls `describe()`, caches the result, and replaces the file part with a synthetic text part.

### Auth resolution

Keys are resolved in this priority order:
1. `~/.local/share/opencode/auth.json` (key/apikey/apiKey field)
2. opencode's provider config (`options.apiKey`)
3. Environment variables (allowlisted per provider package)

### Testing

Tests use vitest, mock `fetch`, and fixture files under `test/fixtures/`. No external services needed.

## Notes

- Runtime provider packages (`@ai-sdk/*`, `@openrouter/ai-sdk-provider`, `ai`) are intentionally dependencies so opencode can load them from its Bun-managed cache.
- Plugin config is stored at `~/.local/share/opencode/opencode-fallback.json`.
- `dist/` is generated; do not hand-edit it.
