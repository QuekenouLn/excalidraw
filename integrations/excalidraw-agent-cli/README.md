# excalidraw-agent-cli

A CLI for the existing Excalidraw MCP server, using MCPorter 0.13.13 as an SDK. Version 0.4.0 provides discovery, generic calls, result delivery, a versioned installer, and an Agent Skill installer. It is installed on company.

The default endpoint is `http://100.64.0.1:3002/mcp`; your machine must be able to reach it over Tailscale. No Agent MCP configuration is read and no local MCP server is started.

## Build and run

Requires Bun 1.3.14 (verified on Linux and company/macOS).

```bash
cd integrations/excalidraw-agent-cli
bun install --frozen-lockfile
bun run build
./bin/excalidraw-agent-cli --help
./bin/excalidraw-agent-cli tools
./bin/excalidraw-agent-cli describe apply_scene_operations
./bin/excalidraw-agent-cli call read_me
```

The bundle contains its dependencies; execution does not invoke a package manager. The development launcher finds Bun on PATH or at `~/.bun/bin/bun`.

## Install, upgrade and rollback

Transfer `dist/cli.js` and `dist/install.js` to the target machine, then run:

```bash
~/.bun/bin/bun /path/to/install.js --bundle /path/to/cli.js
~/.local/bin/excalidraw-agent-cli --version
```

Defaults: releases under `~/.local/share/excalidraw-agent-cli/releases/<version>/`, a `current` symlink, and the launcher at `~/.local/bin/excalidraw-agent-cli`. The launcher pins the installing Bun executable's absolute path. The installer never downloads dependencies or edits shell configuration. Optional `--root` and `--bin-dir` select other locations.

Ensure `~/.local/bin` is on the Agent shell's PATH, or use the absolute launcher path. During the company installation, its existing `.zshenv` was backed up and a guarded user-bin PATH entry was added separately; interactive and non-interactive shells were checked. No Agent MCP configuration was changed.

Reinstalling identical bytes is safe. Different contents under the same version are rejected. New versions preserve the previous release, and unmanaged launchers are not overwritten. To roll back after an upgrade:

```bash
~/.bun/bin/bun ~/.local/share/excalidraw-agent-cli/current/install.js --rollback
```

Rollback requires a previous installed release; first installations report that none exists. The installer uses an exclusive `.install-lock` directory. If interrupted, inspect that no installer is running before removing a stale lock.

The [stage 3 acceptance record](../../docs/excalidraw-agent-cli-stage3-acceptance.md) contains company paths, the isolated test diagram, verified persistence/conflict behavior, and remaining visual checks.

## Agent Skill

The maintained Skill is [skill/excalidraw/SKILL.md](./skill/excalidraw/SKILL.md). It teaches discovery, request/result handling, checkpoint/revision tracking, persistence, conflict recovery, and the limits of visual validation. Tool schemas remain on the server.

After building, copy `dist/install-skill.js` and the `skill/excalidraw/` directory to the target machine:

```bash
~/.bun/bin/bun /path/to/install-skill.js --source /path/to/excalidraw
```

The installer writes a content-addressed copy under `~/.local/share/excalidraw-agent-cli/skills/` and links the Agent, Claude-compatible, and OpenGrok skill directories to that one copy. Existing Excalidraw skills and old in-discovery backup directories are archived under `~/.local/state/excalidraw-agent-cli/skill-backups/`; the backup manifest records original paths. It does not change MCP or model configuration. Reinstalling identical Skill contents creates no duplicate backups.

Start a new Agent session to load the updated Skill. On OpenGrok, use `/excalidraw` or ask it to create/edit a diagram using `excalidraw-agent-cli`. The existing native MCP registration can remain; this workflow uses shell and does not require it. CLI upgrades and Skill changes are independent; a compatible server update does not require either to be regenerated.

To restore an old Skill, use its backup manifest to restore the original paths after removing only the managed links; preserve the canonical Skill revision and backups until the restore is verified. CLI `--rollback` changes the executable version, not Skill contents.

## Commands and inputs

```text
excalidraw-agent-cli tools [options]
excalidraw-agent-cli describe TOOL [options]
excalidraw-agent-cli call TOOL [--input FILE|-] [options]
excalidraw-agent-cli --help
excalidraw-agent-cli --version
```

Common options: `--endpoint URL`, `--timeout-ms MS`, `--output-file PATH`.

Endpoint precedence: `--endpoint`, then `EXCALIDRAW_MCP_URL`, then the default. HTTP and HTTPS are supported; no extra `--allow-http` is required. URLs with credentials or fragments are rejected.

`tools` returns current names and descriptions (up to 200 Unicode characters, with a truncation flag). `describe` returns the full available description and schema, plus a canonical schema hash. Server updates are visible on the next invocation; no schema is cached between processes. Tool names remain unchanged.

`call` accepts one JSON object. Without `--input`, arguments are `{}` and stdin is never read. File and piped input are limited to 16 MiB; interactive stdin is rejected. The CLI validates syntax, object shape, size and its own options; the server validates tool-specific parameters. It does not discard unfamiliar payload fields.

```bash
# A no-argument, read-only tool
excalidraw-agent-cli call read_me

# Explicit JSON file, and the equivalent pipe
excalidraw-agent-cli call list_remote_files --input args.json
printf '%s\n' '{}' | excalidraw-agent-cli call list_remote_files --input -

# Complete result to a new file (parent directory must already exist)
excalidraw-agent-cli call read_me --output-file reference-result.json
```

Online commands emit one JSON object to stdout. Help and version are plain text and work offline. Diagnostics go to stderr. MCP results preserve content blocks (including images), structured content and metadata.

The default operation deadline is 30 seconds, covering input, connection, discovery and tool call, plus at most one second for connection cleanup. Result delivery happens afterwards. Authentication failures do not launch an interactive login. Missing arguments do not prompt.

## Execution state and failures

Every online result has `contractVersion`, `cliVersion`, `ok`, `command`, `execution`, and an optional `tool`. Tool results are under `result`.

- `not_attempted`: no business tool call was attempted (also used for discovery commands).
- `response_received`: a tool response was received. Check `ok` and the business result; this is not a claim that every requested side effect completed.
- `unknown`: the SDK call was entered but no usable result arrived. A remote write may have executed or may still complete. Read current remote state before repeating a write.

The CLI does not retry tool calls. Fault tests verify one submitted call even when the server performs a simulated mutation and then withholds the response or returns HTTP 503. There is no general business dry-run or idempotency guarantee.

| Exit | Meaning |
|---|---|
| 0 | Successful CLI request and no MCP `isError` |
| 2 | Invalid command/options/input or input read failure |
| 3 | Tool missing or incomplete discovery |
| 4 | Connection/authentication/protocol failure |
| 5 | MCP result has `isError: true`, including over HTTP 200 |
| 6 | Deadline exceeded |
| 7 | Output delivery failed or target already exists |

An error object includes a stable `code`, a message and, when useful, a recovery hint. Server error details remain in `result`. Asynchronous or partially successful business results are not flattened into a blanket completion claim.

## Result files

`--output-file` writes the complete JSON envelope to a new file. The CLI checks/reserves a temporary output location before calling the tool and atomically publishes the complete file without overwriting an existing target.

Results exceeding 64 KiB automatically go to `~/.local/state/excalidraw-agent-cli/results/`. stdout contains `resultFile`, byte count and SHA-256 instead of the full payload. Read that file to inspect the complete result; no business request is repeated to produce it. Automatic result files are retained until manually removed.

A failed output publication preserves the execution state and attempts to save a fallback result. Exit 7 then includes `operationOk`, optional `operationError`, and a fallback `resultFile` when recovery succeeds. **Do not repeat a write just because saving its local result failed.**

New result files are created with mode 0600. File output is local to the machine running the CLI; it does not save a diagram on the MCP server. Use the server's save tool for remote persistence.

## Validation and scope

```bash
bun run typecheck
bun run test
```

Tests run the built CLI in subprocesses against isolated HTTP MCP fixtures. They cover discovery/pagination, dynamic tools and fields, JSON input, large output, file races, tool failures, timeouts, lost responses and no duplicate tool calls. Installer tests cover minimal PATH, quoted paths, repeat installs, version conflicts, upgrades/rollback, unmanaged launcher protection, and deduplicated Skill installation with legacy backups preserved. Stage 3 real-server checks use only the dedicated acceptance diagram.

See [the contract](../../docs/excalidraw-agent-cli-design.md), [the task list](../../docs/excalidraw-agent-cli-todos.md), and [the actual Agent acceptance record](../../docs/excalidraw-agent-cli-stage4-acceptance.md). The latter records an isolated OpenGrok run with zero native MCP registrations, its measured cost indicators, the turn-limit continuation, and an independent persistence check.
