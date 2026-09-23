import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const scratch = await mkdtemp(join(tmpdir(), "excalidraw-cli-calls-"));
const entry = resolve(import.meta.dir, "../dist/cli.js");
let calls = 0;
let discoveries = 0;
let extended = false;
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    if (request.method !== "POST")
      return new Response(null, {
        status: request.method === "DELETE" ? 204 : 405,
      });
    const body = (await request.json()) as any;
    const answer = (result: unknown) =>
      Response.json({ jsonrpc: "2.0", id: body.id, result });
    if (body.method === "initialize")
      return answer({
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "call-fixture", version: "1" },
      });
    if (body.method.startsWith("notifications/"))
      return new Response(null, { status: 202 });
    if (body.method === "tools/list") {
      discoveries++;
      if (new URL(request.url).pathname === "/slow-list") await Bun.sleep(400);
      return answer({
        tools: [
          {
            name: "echo",
            inputSchema: {
              type: "object",
              properties: {
                mode: { type: "string" },
                ...(extended ? { newOption: { type: "string" } } : {}),
              },
            },
          },
          ...(extended
            ? [
                {
                  name: "new_tool",
                  inputSchema: { type: "object", properties: {} },
                },
              ]
            : []),
        ],
      });
    }
    if (body.method === "tools/call") {
      calls++;
      const args = body.params.arguments;
      if (args.mode === "lost") return new Promise<Response>(() => {});
      if (args.mode === "disconnect")
        return new Response("Response lost after mutation", { status: 503 });
      if (args.mode === "race")
        await writeFile(args.path, "created by another process");
      return answer({
        ...(args.mode === "error" ? { isError: true } : {}),
        content: [
          {
            type: "text",
            text:
              args.mode === "large" ? "图".repeat(30000) : JSON.stringify(args),
          },
          { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
        ],
        structuredContent: {
          received: args,
          ...(args.mode === "error" ? { code: "REVISION_CONFLICT" } : {}),
        },
        _meta: { retained: true },
      });
    }
    return new Response(null, { status: 400 });
  },
});
afterAll(async () => {
  server.stop(true);
  await rm(scratch, { recursive: true, force: true });
});

async function cli(args: string[], input?: string, holdStdin = false) {
  const child = Bun.spawn([process.execPath, entry, ...args], {
    env: {
      ...process.env,
      HOME: scratch,
      EXCALIDRAW_MCP_URL: `http://127.0.0.1:${server.port}/mcp`,
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (input !== undefined) child.stdin.write(input);
  if (!holdStdin) child.stdin.end();
  const timer = setTimeout(() => child.kill(), 5000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { data: JSON.parse(stdout), stdout, stderr, code };
  } finally {
    clearTimeout(timer);
  }
}

describe("calls, delivery and failure recovery", () => {
  test("default arguments never implicitly read stdin; raw result retains image/structured/meta fields", async () => {
    const result = await cli(["call", "echo"], undefined, true);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.data.execution).toBe("response_received");
    expect(result.data.result.structuredContent.received).toEqual({});
    expect(result.data.result.content[1].type).toBe("image");
    expect(result.data.result._meta.retained).toBe(true);
  });

  test("file and piped JSON preserve nested, Unicode and future fields", async () => {
    const args = {
      text: "中文 ' $() ` `",
      nested: { operations: [1, true] },
      future: "allowed",
    };
    const path = join(scratch, "input.json");
    await writeFile(path, JSON.stringify(args));
    for (const result of [
      await cli(["call", "echo", "--input", path]),
      await cli(["call", "echo", "--input", "-"], JSON.stringify(args)),
    ]) {
      expect(result.code).toBe(0);
      expect(result.data.result.structuredContent.received).toEqual(args);
    }
  });

  test("bad JSON and non-object inputs are rejected before discovery or a call", async () => {
    const before = calls;
    const beforeDiscovery = discoveries;
    for (const data of ["", "{", "[]", "null", "42"]) {
      const result = await cli(["call", "echo", "--input", "-"], data);
      expect(result.code).toBe(2);
      expect(result.data.error.code).toBe("INVALID_INPUT");
      expect(result.data.execution).toBe("not_attempted");
    }
    expect(calls).toBe(before);
    expect(discoveries).toBe(beforeDiscovery);
  });

  test("missing file and oversized input fail locally", async () => {
    const before = calls;
    const absent = await cli([
      "call",
      "echo",
      "--input",
      join(scratch, "missing"),
    ]);
    expect(absent.data.error.code).toBe("INPUT_IO_ERROR");
    const large = join(scratch, "too-large.json");
    await writeFile(large, " ".repeat(16 * 1024 * 1024 + 1));
    const result = await cli(["call", "echo", "--input", large]);
    expect(result.data.error.code).toBe("INPUT_TOO_LARGE");
    expect(calls).toBe(before);
  });

  test("open stdin without data respects the command deadline", async () => {
    const before = calls;
    const result = await cli(
      ["call", "echo", "--input", "-", "--timeout-ms", "100"],
      undefined,
      true,
    );
    expect(result.code).toBe(6);
    expect(result.data.execution).toBe("not_attempted");
    expect(calls).toBe(before);
  });

  test("HTTP 200 with isError is a tool failure and preserves server error details", async () => {
    const result = await cli(
      ["call", "echo", "--input", "-"],
      '{"mode":"error"}',
    );
    expect(result.code).toBe(5);
    expect(result.data.ok).toBe(false);
    expect(result.data.error.code).toBe("TOOL_ERROR");
    expect(result.data.execution).toBe("response_received");
    expect(result.data.result.structuredContent.code).toBe("REVISION_CONFLICT");
  });

  test("new tool and optional schema field work without rebuilding", async () => {
    extended = true;
    try {
      const result = await cli(
        ["call", "new_tool", "--input", "-"],
        '{"newOption":"new"}',
      );
      expect(result.code).toBe(0);
      expect(result.data.result.structuredContent.received.newOption).toBe(
        "new",
      );
    } finally {
      extended = false;
    }
  });

  test("explicit result file is complete and its digest matches the summary", async () => {
    const path = join(scratch, "result.json");
    const result = await cli(["call", "echo", "--output-file", path]);
    expect(result.code).toBe(0);
    expect(result.data.resultFile).toBe(path);
    const bytes = await readFile(path);
    expect(bytes.length).toBe(result.data.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      result.data.sha256,
    );
    expect(
      JSON.parse(bytes.toString()).result.structuredContent.received,
    ).toEqual({});
    const before = calls;
    const again = await cli(["call", "echo", "--output-file", path]);
    expect(again.code).toBe(7);
    expect(again.data.error.code).toBe("OUTPUT_EXISTS");
    expect(again.data.execution).toBe("not_attempted");
    expect(calls).toBe(before);
    expect(await readFile(path)).toEqual(bytes);
  });

  test("large output is saved once and is not truncated or re-requested", async () => {
    const before = calls;
    const result = await cli(
      ["call", "echo", "--input", "-"],
      '{"mode":"large"}',
    );
    expect(result.code).toBe(0);
    expect(result.stdout.length).toBeLessThan(2000);
    const saved = JSON.parse(await readFile(result.data.resultFile, "utf8"));
    expect(saved.result.content[0].text).toBe("图".repeat(30000));
    expect(calls).toBe(before + 1);
  });

  test("output race keeps the other file and saves a fallback without repeating mutation", async () => {
    const before = calls;
    const path = join(scratch, "raced.json");
    const result = await cli(
      ["call", "echo", "--input", "-", "--output-file", path],
      JSON.stringify({ mode: "race", path }),
    );
    expect(result.code).toBe(7);
    expect(result.data.error.code).toBe("OUTPUT_EXISTS");
    expect(result.data.execution).toBe("response_received");
    expect(result.data.operationOk).toBe(true);
    expect(await readFile(path, "utf8")).toBe("created by another process");
    const recovered = JSON.parse(
      await readFile(result.data.resultFile, "utf8"),
    );
    expect(recovered.ok).toBe(true);
    expect(calls).toBe(before + 1);
    expect((await readdir(scratch)).filter((p) => p.endsWith(".tmp"))).toEqual(
      [],
    );
  });

  test("accepted write with lost response is unknown and never resent", async () => {
    const before = calls;
    const result = await cli(
      ["call", "echo", "--input", "-", "--timeout-ms", "300"],
      '{"mode":"lost"}',
    );
    expect(result.code).toBe(6);
    expect(result.data.execution).toBe("unknown");
    expect(result.data.error.hint).toContain("before repeating a write");
    expect(calls).toBe(before + 1);
  });

  test("HTTP failure after accepted write is unknown and not retried by SDK", async () => {
    const before = calls;
    const result = await cli(
      ["call", "echo", "--input", "-"],
      '{"mode":"disconnect"}',
    );
    expect(result.code).toBe(4);
    expect(result.data.execution).toBe("unknown");
    expect(calls).toBe(before + 1);
  });

  test("discovery completing after deadline cannot submit a late tool call", async () => {
    const before = calls;
    const result = await cli([
      "call",
      "echo",
      "--endpoint",
      `http://127.0.0.1:${server.port}/slow-list`,
      "--timeout-ms",
      "100",
    ]);
    expect(result.code).toBe(6);
    expect(result.data.execution).toBe("not_attempted");
    await Bun.sleep(450);
    expect(calls).toBe(before);
  });
});
