import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { createRuntime, type Runtime } from "mcporter";
import { version } from "../package.json";
import { CliError, type Envelope, type Outcome } from "./contract";
import { readInput } from "./input";
import {
  deliver,
  discardOutput,
  reserveOutput,
  type Destination,
} from "./output";

export const VERSION = version;
export const DEFAULT_ENDPOINT = "http://100.64.0.1:3002/mcp";
export const HELP = `excalidraw-agent-cli — discover the remote Excalidraw tools

Usage:
  excalidraw-agent-cli tools [options]
  excalidraw-agent-cli describe <tool> [options]
  excalidraw-agent-cli call <tool> [--input <file|->] [options]

Options:
  --endpoint <url>       Override EXCALIDRAW_MCP_URL and the built-in endpoint
  --timeout-ms <ms>      Whole-command deadline (default: 30000)
  --input <file|->      JSON object from a file or piped stdin (call only)
  --output-file <path>  Save the complete JSON result; never overwrite a file
  --help                Show this help (offline)
  --version             Show the CLI version (offline)

Default endpoint: ${DEFAULT_ENDPOINT}
Online commands emit JSON to stdout; errors also return a nonzero exit code.
No MCP client configuration, interactive login, or local server is needed.

Examples:
  excalidraw-agent-cli tools
  excalidraw-agent-cli describe apply_scene_operations

  excalidraw-agent-cli call read_me

Calls default to {} when --input is absent; stdin is never read implicitly.
Results larger than 64 KiB are saved to a local result file automatically.
Calls are never automatically retried. A timed-out write may still execute.
`;

type Command = "tools" | "describe" | "call";
type Request = {
  command: Command;
  tool?: string;
  endpoint: URL;
  timeoutMs: number;
  input?: string;
  outputFile?: string;
};

function parse(
  argv: string[],
  env: NodeJS.ProcessEnv,
): Request | "help" | "version" {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: true,
      tokens: true,
      options: {
        endpoint: { type: "string" },
        "timeout-ms": { type: "string" },
        input: { type: "string" },
        "output-file": { type: "string" },
        help: { type: "boolean" },
        version: { type: "boolean" },
      },
    });
  } catch {
    throw new CliError(
      "INVALID_ARGUMENT",
      2,
      "Invalid command-line options.",
      "Run --help for accepted options.",
    );
  }
  const seen = new Set<string>();
  for (const token of parsed.tokens ?? []) {
    if (token.kind !== "option") continue;
    if (seen.has(token.name)) {
      throw new CliError(
        "INVALID_ARGUMENT",
        2,
        `Option --${token.name} must appear only once.`,
      );
    }
    seen.add(token.name);
  }
  if (parsed.values.help && parsed.values.version) {
    throw new CliError(
      "INVALID_ARGUMENT",
      2,
      "Choose --help or --version, not both.",
    );
  }
  if (parsed.values.help || argv.length === 0) return "help";
  if (parsed.values.version) return "version";
  const [command, tool, ...extra] = parsed.positionals;
  if (command !== "tools" && command !== "describe" && command !== "call") {
    throw new CliError(
      "INVALID_ARGUMENT",
      2,
      "Expected tools, describe, or call.",
      "Run --help for examples.",
    );
  }
  if (
    extra.length ||
    (command === "tools" && tool) ||
    (command !== "tools" && !tool)
  ) {
    throw new CliError(
      "INVALID_ARGUMENT",
      2,
      command === "tools"
        ? "tools takes no positional arguments."
        : `${command} requires exactly one tool name.`,
    );
  }
  if (parsed.values.input !== undefined && command !== "call") {
    throw new CliError(
      "INVALID_ARGUMENT",
      2,
      "--input is only available for call.",
    );
  }
  for (const key of ["input", "output-file"] as const) {
    if (parsed.values[key] === "")
      throw new CliError(
        "INVALID_ARGUMENT",
        2,
        `--${key} requires a nonempty path.`,
      );
  }
  const rawTimeout = parsed.values["timeout-ms"] ?? "30000";
  if (
    typeof rawTimeout !== "string" ||
    !/^[1-9]\d*$/.test(rawTimeout) ||
    Number(rawTimeout) > 2_147_483_647
  ) {
    throw new CliError(
      "INVALID_ARGUMENT",
      2,
      "--timeout-ms must be an integer between 1 and 2147483647.",
    );
  }
  const rawEndpoint =
    parsed.values.endpoint ?? env.EXCALIDRAW_MCP_URL ?? DEFAULT_ENDPOINT;
  let endpoint: URL;
  try {
    endpoint = new URL(String(rawEndpoint));
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.hash
    )
      throw new Error();
  } catch {
    throw new CliError(
      "INVALID_ARGUMENT",
      2,
      "Endpoint must be an HTTP(S) URL without embedded credentials or a fragment.",
    );
  }
  return {
    command,
    tool,
    endpoint,
    timeoutMs: Number(rawTimeout),
    input: parsed.values.input as string | undefined,
    outputFile: parsed.values["output-file"] as string | undefined,
  };
}

// Canonical JSON hashing avoids flagging changes caused only by object key order.
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(",")}}`;
}

function classify(error: unknown): CliError {
  if (error instanceof CliError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/401|403|unauthorized|forbidden|oauth/i.test(message)) {
    return new CliError(
      "AUTH_REQUIRED",
      4,
      "The server requires authorization; interactive login is disabled.",
    );
  }
  if (/timeout|timed out/i.test(message)) {
    return new CliError(
      "DEADLINE_EXCEEDED",
      6,
      "The MCP request did not finish before the deadline.",
    );
  }
  if (
    /ECONN|fetch|connect|network|socket|ENOTFOUND|resolve|closed/i.test(message)
  ) {
    return new CliError(
      "CONNECTION_FAILED",
      4,
      "Could not complete a connection to the MCP server.",
      "Check the endpoint, Tailscale connection, and server availability.",
    );
  }
  if (/pag|cursor/i.test(message)) {
    return new CliError(
      "INCOMPLETE_DISCOVERY",
      3,
      "The server tool directory could not be fully retrieved.",
    );
  }
  return new CliError(
    "PROTOCOL_ERROR",
    4,
    "The server did not return a usable MCP response.",
  );
}

function envelope(command: string, tool?: string): Envelope {
  return {
    contractVersion: 1,
    cliVersion: VERSION,
    ok: true,
    command,
    ...(tool ? { tool } : {}),
    execution: "not_attempted",
  };
}

export async function run(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<Outcome> {
  let base = envelope("cli");
  let runtime: Runtime | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  let output: Destination | undefined;
  const abort = new AbortController();
  let outcome: { code: number; json: Envelope };
  try {
    const request = parse(argv, env);
    if (request === "help") return { code: 0, text: HELP };
    if (request === "version") return { code: 0, text: `${VERSION}\n` };
    base = envelope(request.command, request.tool);
    const deadline = new Promise<never>((_, reject) => {
      deadlineTimer = setTimeout(() => {
        const error = new CliError(
          "DEADLINE_EXCEEDED",
          6,
          "The command deadline expired.",
          "Check connectivity or increase --timeout-ms.",
        );
        abort.abort(error);
        reject(error);
      }, request.timeoutMs);
    });
    const operation = async (): Promise<{ code: number; json: Envelope }> => {
      if (request.outputFile) {
        const reserved = await reserveOutput(request.outputFile);
        if (abort.signal.aborted) {
          await discardOutput(reserved);
          abort.signal.throwIfAborted();
        }
        output = reserved;
      }
      const args = await readInput(request.input, abort.signal);
      abort.signal.throwIfAborted();
      runtime = await createRuntime({
        servers: [
          {
            name: "excalidraw",
            command: { kind: "http", url: request.endpoint },
          },
        ],
        clientInfo: { name: "excalidraw-agent-cli", version: VERSION },
        // SDK logs may contain server payloads; structured errors are the public diagnostic surface.
        logger: { debug() {}, info() {}, warn() {}, error() {} },
      });
      abort.signal.throwIfAborted();
      const tools = await runtime.listTools("excalidraw", {
        includeSchema: true,
        disableOAuth: true,
        timeoutMs: request.timeoutMs,
      });
      abort.signal.throwIfAborted();
      const names = new Set<string>();
      for (const tool of tools) {
        if (typeof tool.name !== "string" || names.has(tool.name)) {
          throw new CliError(
            "INCOMPLETE_DISCOVERY",
            3,
            "The tool directory contains invalid or duplicate names.",
          );
        }
        names.add(tool.name);
      }
      if (request.command === "tools") {
        const summary = tools
          .map(({ name, description }) => {
            const chars = Array.from(description ?? "");
            return {
              name,
              description: chars.slice(0, 200).join(""),
              descriptionTruncated: chars.length > 200,
            };
          })
          .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        return {
          code: 0,
          json: {
            ...base,
            result: { tools: summary, count: summary.length, complete: true },
          },
        };
      }
      const selected = tools.find(({ name }) => name === request.tool);
      if (!selected)
        throw new CliError(
          "TOOL_NOT_FOUND",
          3,
          `Tool ${request.tool} is not available.`,
          "Run tools to discover current tool names.",
        );
      if (request.command === "call") {
        abort.signal.throwIfAborted();
        base.execution = "unknown";
        const result = await runtime.callTool("excalidraw", request.tool!, {
          args,
          disableOAuth: true,
          timeoutMs: request.timeoutMs,
        });
        abort.signal.throwIfAborted();
        base.execution = "response_received";
        const failed =
          !!result &&
          typeof result === "object" &&
          (result as { isError?: boolean }).isError === true;
        return {
          code: failed ? 5 : 0,
          json: {
            ...base,
            ok: !failed,
            result,
            ...(failed
              ? {
                  error: {
                    code: "TOOL_ERROR",
                    message: "Server reported a tool error.",
                    hint: "Inspect result before deciding whether to correct input or read current state.",
                  },
                }
              : {}),
          },
        };
      }
      const schema = {
        inputSchema: selected.inputSchema ?? null,
        outputSchema: selected.outputSchema ?? null,
      };
      return {
        code: 0,
        json: {
          ...base,
          result: {
            ...selected,
            schemaAvailable: selected.inputSchema !== undefined,
            schemaHash: createHash("sha256")
              .update(canonical(schema))
              .digest("hex"),
          },
        },
      };
    };
    outcome = await Promise.race([operation(), deadline]);
  } catch (error) {
    const failure = classify(error);
    const hint =
      base.execution === "unknown"
        ? "The remote operation may have executed or may still complete. Read the target file/checkpoint before repeating a write."
        : failure.hint;
    outcome = {
      code: failure.exitCode,
      json: {
        ...base,
        ok: false,
        error: {
          code: failure.code,
          message: failure.message,
          ...(hint ? { hint } : {}),
        },
      },
    };
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    if (runtime) {
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          runtime.close().catch(() => {
            console.error("MCP connection cleanup failed.");
          }),
          new Promise<void>((resolve) => {
            cleanupTimer = setTimeout(resolve, 1000);
          }),
        ]);
      } finally {
        if (cleanupTimer) clearTimeout(cleanupTimer);
      }
    }
  }
  return deliver(outcome.json, outcome.code, output);
}
