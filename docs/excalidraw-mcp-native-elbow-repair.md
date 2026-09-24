# Native Elbow MCP repair plan

## Goal

Repair the native Elbow integration reviewed in parent commit `c941f3b2` and MCP submodule commit `7f59d58`. Preserve native routing, bindings, labels, and endpoint positions through subsequent atomic edits, and make the supported Docker build reproducible.

## Design

This fork builds the MCP server together with the matching Excalidraw monorepo. Native geometry is bundled into the server at build time; the runtime image needs only `dist`. The monorepo commit and its recorded MCP submodule revision define the source pair. A standalone checkout of this MCP fork is not a supported source build until the native geometry adapter is supplied as a versioned package.

Keep the small native geometry adapter as the integration boundary. Use native global endpoint calculations for rotated arrows, native routing when refreshing Elbow arrows, and native bound-text positioning for arrow labels. Preserve intermediate points when changing sharp/round styling; collapse points only when leaving Elbow mode.

## Work items

- [x] Replace the submodule-only Docker build with an explicit monorepo build, including both dependency installations and a restricted Docker context. Add a clear build prerequisite diagnostic and document local/container builds.
- [x] Fix node-label edits so connected Elbow arrows remain orthogonal and their labels follow their routes.
- [x] Preserve intermediate points for sharp/round changes and repeated type requests.
- [x] Preserve global endpoints when converting rotated arrows to Elbow.
- [x] Add regression tests for these failures, label positioning, and atomic input preservation.
- [x] Run MCP tests/build, parent conversion tests and typecheck, and validate the Docker build when the environment permits. Update the code graph.
- [x] Record results and remaining acceptance limits here.

## Deployment boundary

The user accepted the browser verification and authorized committing and deploying to the existing service on port `3002`. No additional service, temporary server process, or alternate listening port may be started without explicit user approval, including for verification. Reuse the existing service and preserve its checkpoint volume. Updating the CLI alone does not change server capabilities.

## Acceptance

The built server must expose `set_arrow_type` and execute the regression scenarios without relying on source files at runtime. A real browser drag remains a separate visual acceptance check; passing server geometry tests does not establish browser acceptance.

## Reproduce validation

From the monorepo root, after installing dependencies:

```bash
bun test --cwd integrations/excalidraw-mcp
npm --prefix integrations/excalidraw-mcp run build
yarn vitest run tests/excalidraw-mcp/server-element-conversion.test.ts
yarn test:typecheck
docker compose config --quiet
docker build -f deploy/excalidraw-mcp.Dockerfile -t local/excalidraw-mcp:elbow-review .
# Requires explicit approval: starts a separate disposable server container.
# node integrations/excalidraw-mcp/scripts/smoke-container.mjs local/excalidraw-mcp:elbow-review
graphify update .
```

The smoke script starts a disposable container with `--network none` and no source or dependency mounts. It mounts only the repository's Maple Mono font file read-only through the existing `MCP_MAPLE_FONT_PATH` option. Normal deployment continues to use the configured font URL. The test talks to the bundled Node server over MCP stdio and closes the container afterward.

## Results

- MCP tests: **65 passed, 0 failed**, including six new regression cases.
- Parent server-element conversion tests: **12 passed**.
- Parent TypeScript check and host MCP production build: **passed**.
- Compose configuration validation: **passed**.
- Docker build from the restricted monorepo context: **passed**, producing `local/excalidraw-mcp:elbow-review`.
- Runtime-image smoke test: **passed** for `set_arrow_type` discovery, `create_view`, bound Elbow routing after a node rename, global endpoint preservation for a rotated arrow, and source checkpoint immutability.
- AST graph updated. Graphify reported two configuration files with no extracted nodes and skipped HTML visualization because the graph exceeds 5,000 nodes; JSON/report generation succeeded.

The native adapter preserves fixed segments during refresh and delegates arrow-label positioning to native geometry. Derived label changes are attributed through their arrow's endpoint triggers, including when a checkpoint lists text before its container.

Browser verification was subsequently accepted by the user, who authorized deployment to the existing `3002` service. The container smoke results above predate the new restriction on additional services. Deployment verification reused `3002`; no new test server was started. The remote diagram was not modified.

Before commit, `yarn test:update` ran and reported **28 failed / 240 passed test files**, with **40 failed / 3,747 passed tests** and 10 unhandled errors. Failures include Bun-only suites collected by Vitest, existing editor assertions and export timeouts; Vitest also collected the nested `.worktrees/markdown-frame` checkout. Generated snapshot and inline-snapshot changes were discarded. MCP tests were rerun with Bun: **65 passed, 0 failed**. These full-suite failures remain outside this repair's scope.

## Deployment result

- MCP implementation committed as `94e66ac`.
- Deployed the previously built and container-tested `local/excalidraw-mcp:elbow-review` image, digest `sha256:6c9872277b66545723b38cd3aec801216a749e79c7d5ec80897e7f8d78fd67b8`, to the existing Compose service using `docker compose up -d --no-deps --no-build excalidraw-mcp`. A redundant rebuild was cancelled after stalling on dependency download; subsequent runtime-source changes since the verified image build were formatting only.
- Existing port `3002` is healthy. Live MCP discovery includes `add_edge`, `set_arrow_type`, `set_edge_label`, and `set_node_label`; `add_edge.arrowType` defaults to `elbow`. The read-only `read_me` call succeeded.
- The named `excalidraw-mcp-checkpoints` volume was retained, with 100 files before and after deployment.
- The earlier temporary host process on `3005` was identified and stopped; that port no longer listens.
- The old image is retained locally as `local/excalidraw-mcp:before-elbow-fix` for rollback.
