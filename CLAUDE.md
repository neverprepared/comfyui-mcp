# CLAUDE.md

Guidance for AI agents (Claude Code and friends) working in this repository.

## Overview

**comfyui-mcp** — a local-first MCP server that lets an AI agent drive
[ComfyUI](https://github.com/comfyanonymous/ComfyUI): generate images/video/audio/3D, author
and run workflows, manage models and custom nodes, install ComfyUI itself, and train LoRAs.
It also ships as a Claude Code plugin (skills, slash commands, agents, hooks) and as a
background **orchestrator** that drives the ComfyUI sidebar panel with an autonomous agent.

- Package: `comfyui-mcp` (ESM, Node ≥ 22), binary `comfyui-mcp` → `dist/index.js`.
- This repo is `neverprepared/comfyui-mcp`, a hardened **fork** of `artokun/comfyui-mcp`.
  `plugin/.mcp.json` is pinned to `github:neverprepared/comfyui-mcp#v0.50.108-np.1` and
  self-update is disabled (`COMFYUI_MCP_AUTOUPDATE=0`), because the package name is still
  `comfyui-mcp` and an active self-update would replace the fork with upstream.
  Keep security fixes as separate, cleanly-upstreamable commits.

## Commands

```bash
npm install          # deps (builds native better-sqlite3, sharp)
npm run build        # tsc → dist/
npm run lint         # tsc --noEmit (type-check only — there is no ESLint)
npm test             # vitest run --passWithNoTests
npm run test:watch   # vitest watch
npm run dev          # run from source via tsx (src/index.ts)
npm start            # node dist/index.js
```

CI-enforced gates (`.github/workflows/ci.yml`) — run these before pushing:

```bash
npm run docs:gen              # regenerate docs/tools/*.mdx; must be a NO-OP in CI
npm run vocab:export -- --check   # docs/design/tool-vocabulary.json must be current
npm run check:vocabulary      # no live references to retired tool names
npm run check:unknown-collapse    # "could not determine" must not collapse to a false negative
node scripts/asset-counts.mjs --check   # README tool/skill/pack counts must match the registry
```

A second, path-filtered workflow (`.github/workflows/packs.yml`) runs `packs:validate`, a
`packs:gen` staleness check, `scripts/test-packs.sh` and `check-model-urls.mjs` — but only when
`packs/**` or its scripts change.

Other useful scripts: `npm run smoke` (pack + install a tarball into a clean project),
`npm run smoke:panel`, `npm run test:integration` (needs a live ComfyUI; `COMFYUI_INTEGRATION=true`),
`npm run arena` (LLM Arena benchmark), `npm run packs:validate` / `packs:gen` / `packs:test`.

## Architecture

```
src/
  index.ts        # launcher ONLY — dynamically imports boot.js so a damaged install
                  #   reports itself instead of dying in Node's resolver. Keep it
                  #   free of package imports; that is load-bearing.
  boot.ts         # CLI parsing, server construction, transport wiring, panel autoinstall
  config.ts       # configuration + env resolution
  transport/      # cli.ts (arg parsing + --help), http.ts (streamable HTTP), comfyui-url.ts
  tools/          # thin MCP tool wrappers — one registerXxxTools(server) per file
    index.ts      #   TOOL_GROUPS: the single registration list (order is observable)
    vocabulary.ts #   TOOL_NAMES (live surface) + DEAD_NAMES (retired) — the source of truth
    catalog.ts, compact.ts   # compact tool mode (list_tools/describe_tool/call_tool facade)
  services/       # the actual logic (network, subprocess, filesystem) — ~130 modules
  orchestrator/   # panel orchestrator: UI bridge + one agent session per ComfyUI tab,
                  #   with pluggable backends (claude, codex, gemini, ollama, copilot, …)
  comfyui/        # ComfyUI client, websocket events, workflow types, JSON guard
  experimental/   # agent PoC (npm run dev:agent-poc)
  __tests__/      # vitest, mirroring the source path
plugin/           # Claude Code plugin: 38 skills, 11 slash commands, 4 agents, hooks
packs/            # 56 installer packs (pack.yaml + manifest.yaml + workflow.json + installers)
scripts/          # build/docs/check/arena/pack utilities
docs/             # Mintlify site; docs/tools/*.mdx is GENERATED (npm run docs:gen)
```

**Separation of concerns:** logic lives in `src/services/<name>.ts`; `src/tools/<name>.ts` is a
thin wrapper that defines the MCP tool and calls the service.

### Tool surface

The live surface is **37 tools**, listed canonically in `src/tools/vocabulary.ts` (`TOOL_NAMES`):

`comfy_cli`, `enqueue_workflow`, `get_system_stats`, `visualize_workflow`, `create_workflow`,
`queue`, `search_custom_nodes`, `download_model`, `list_local_models`, `get_history`, `runpod`,
`runpod_watch`, `get_workflow`, `save_workflow`, `restart_comfyui`, `get_image`, `upload_image`,
`clear_vram`, `get_defaults`, `generate_image`, `node_snapshot`, `bisect`, `install_custom_node`,
`report_issue`, `install_comfyui`, `model_metadata`, `workspace`, `list_api_nodes`, `node_pack`,
`apply_manifest`, `list_packs`, `calculate`, `train_prepare_dataset`, `train_start`, `train_doctor`,
`apps`, `batch` — plus autoloaded saved workflows registered at runtime.

Many older tool names were **consolidated into `action:` parameters** on the survivors (e.g.
`search_models` → `download_model`, `get_queue` → `queue`, the generate_* family →
`generate_image`, `analyze_color`/`convert_image` → `get_image`). `docs/design/tool-surface.txt`
is a **historical cumulative ledger**, not the live surface — do not read it as such. Retired
names live in `DEAD_NAMES` and are redirected by `src/tools/retired-redirect.ts`; referring to one
in a hint string is a CI failure (`npm run check:vocabulary`).

Two extra surfaces layer on top:

- **Compact mode** (`--compact` / `COMFYUI_MCP_TOOL_MODE=compact`) exposes only `list_tools` /
  `describe_tool` / `call_tool` so small/local models stay effective. It is **opt-in**: `full`
  has been the default since 0.50.0 (`src/transport/cli.ts`), and full still layers the
  `call_tool` facade on top unless `COMFYUI_MCP_NO_FACADE=1`.
- **Blind mode** (`COMFYUI_MCP_BLIND=1`) scrubs every image block from every tool result at the
  single registration boundary in `src/tools/index.ts` — never add a per-tool opt-in.

### Running it

```
comfyui-mcp [--compact|--full] [--stdio|--http] [--host H] [--port P] [--token T] [--tunnel]
comfyui-mcp connect [<comfyui-url>]      # panel orchestrator against a (possibly remote) ComfyUI
comfyui-mcp setup <hermes|openclaw|copilot>   # write the harness config entry, then exit
comfyui-mcp --help
```

Key env vars: `COMFYUI_URL`, `COMFYUI_MCP_TOOL_MODE`, `MCP_TRANSPORT`, `MCP_HOST`, `MCP_PORT`,
`COMFYUI_MCP_HTTP_TOKEN`, `MCP_TUNNEL`, `COMFYUI_MCP_BLIND`, `COMFYUI_MCP_NO_FACADE`,
`COMFYUI_MCP_PANEL_AUTOINSTALL`, `COMFYUI_MCP_AUTOUPDATE`, `COMFY_CLI_PATH`. See `.env.example`.

## Conventions

- **ESM** — relative imports must carry the `.js` extension, even from `.ts` files.
- **Errors** — throw the typed errors in `src/utils/errors.ts` and convert at the tool boundary
  with `errorToToolResult(err)`.
- **Local vs remote** — the server can target a remote ComfyUI. A tool that needs a local install
  must read `config.comfyuiPath` and fail with a clear message when it is undefined.
- **Never collapse an unknown into a negative** — a caught failure must not be answered with
  `[] / null / false`; that tells the caller a negative was *observed*. Enforced by
  `npm run check:unknown-collapse`.
- **Tool registration order is observable** — append new groups to `TOOL_GROUPS`, never insert.
- **Adding/removing a tool** means updating `TOOL_NAMES`/`DEAD_NAMES`, regenerating
  `docs/tools/` and `docs/design/tool-vocabulary.json`, and refreshing the README counts.
- **Tests are required** for behaviour changes; they live in `src/__tests__/` mirroring the source.
- See `CONTRIBUTING.md` for the full guide (security rules, adding a tool, release process).

## Issue tracking

`.beads/` is committed: this repo uses **bd (beads)** with git hooks (`pre-commit`, `pre-push`,
`post-merge`, …). Run `bd prime` for the workflow if you are tracking work here.

## Known state (audited 2026-09-08)

`npm run lint` and `npm run build` are clean. `npm test` has **11 pre-existing failures** in
5 files on a clean `main` checkout in a Linux container — `code-provider-auth`,
`oauth-landing`, `backend-readiness`, `live-probe-gate`, `lora-catalog`. They are
environment-sensitive (host `~/.codex` state, `rename()` EISDIR behaviour), not caused by
repository changes. Do not treat them as a signal that your change broke something; do check
that you have not added to them.
