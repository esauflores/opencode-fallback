# opencode-fallback

Multimodal fallback plugin for [opencode](https://opencode.ai). When your active model can't read images, PDFs, audio, or video, a separate fallback model describes the content and the description is injected as text into the chat.

Based on [zensi-dev/opencode-multimodal](https://github.com/zensi-dev/opencode-multimodal).

## Setup

```bash
pnpm install        # install deps
pnpm run build      # build server → dist/server.js
pnpm run typecheck  # verify types
pnpm run test       # run test suite
```

## Dev workflow

The repo self-loads as a local plugin via `.opencode/*.json` — open opencode from the repo root and it picks up the dev version.

| What you change | What you do                                                                |
| --------------- | -------------------------------------------------------------------------- |
| `src/server.ts` | `pnpm run build` (or `pnpm run dev` for watch mode), then restart opencode |
| `src/tui.tsx`   | Just restart opencode (loaded as raw TSX, no build)                        |

## Before committing

```bash
pnpm run build && pnpm run typecheck && pnpm run test && pnpm run lint && pnpm run format
```

## Architecture

Flat `src/` — one file per concern, see [AGENTS.md](./AGENTS.md) for the full map.

```
src/
├── types.ts      Shared types (Modality, PluginConfig, provider/model shapes)
├── util.ts       MIME→modality, data URL decoding, secret redaction
├── config.ts     Plugin config read/write/normalize, XDG paths
├── auth.ts       API key resolution (auth.json → config → env, allowlisted)
├── models.ts     models.json catalog load/merge/fetch, capability lookups
├── describe.ts   Provider package import + ai.generateText for attachments
├── parts.ts      Scan messages for unsupported file parts, replace with text
├── prompts.ts    Default analysis prompts per modality
├── server.ts     Plugin entry: hooks, cache, limiter, fallback select, transform
├── tui.tsx       /fallback interactive config UI (provider/model picker, settings)
└── shims.d.ts    Type stubs for dynamically loaded packages (ai, @ai-sdk/*)
```

### Data flow

1. Hooks `chat.message` / `chat.params` record the active model per session.
2. On `messages.transform`, the plugin checks which modalities the active model can't handle.
3. For each unsupported attachment: select fallback model, resolve API key, call `describe()`, cache result, replace file part with synthetic text.

### Auth resolution priority

1. `~/.local/share/opencode/auth.json`
2. opencode provider config (`options.apiKey`)
3. Environment variables (allowlisted per `@ai-sdk/*` package)

## Config

Stored at `~/.local/share/opencode/opencode-fallback.json`. Use `/fallback` in opencode to edit interactively, or write it manually:

```json
{
  "version": 1,
  "enabled": true,
  "modalities": {
    "image": { "enabled": true, "providerID": "openai", "modelID": "gpt-4o", "prompt": null }
  },
  "settings": {
    "cache_ttl_ms": 1800000,
    "concurrency": 3,
    "per_call_timeout_ms": 30000,
    "toast_on_missing_fallback": true
  }
}
```

## Tests

```bash
pnpm run test          # vitest run
pnpm run test:watch    # vitest watch mode
```

Uses mock `fetch` + fixture files under `test/fixtures/`. No external services needed.

## License

MIT
