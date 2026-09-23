import { afterAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const entry = resolve(import.meta.dir, "../dist/cli.js");
let added = false;
let targetCalls = 0;
let initialized = 0;
let pageTwo = 0;
const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/stall") return new Promise<Response>(() => {});
    if (path === "/auth") return new Response("Unauthorized", { status: 401 });
    if (request.method === "DELETE") return new Response(null, { status: 204 });
    if (request.method !== "POST") return new Response(null, { status: 405 });
    const body = (await request.json()) as {
      id?: number;
      method: string;
      params?: { cursor?: string };
    };
    if (body.method === "initialize") {
      initialized++;
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "fixture", version: "1" },
        },
      });
    }
    if (body.method === "notifications/initialized")
      return new Response(null, { status: 202 });
    if (body.method === "tools/call") targetCalls++;
    if (body.method === "tools/list") {
      if (path === "/broken")
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: { tools: "not-an-array" },
        });
      if (body.params?.cursor === "page2") pageTwo++;
      const second = {
        name: "zeta",
        description: "Second page",
        inputSchema: { type: "object", properties: {} },
      };
      const primary = {
        name: "alpha",
        description: "中".repeat(205),
        inputSchema: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        },
      };
      const tools = body.params?.cursor
        ? [second]
        : [primary, ...(added ? [{ ...second, name: "new_tool" }] : [])];
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          tools,
          ...(!body.params?.cursor ? { nextCursor: "page2" } : {}),
        },
      });
    }
    return Response.json({
      jsonrpc: "2.0",
      id: body.id,
      error: { code: -32601, message: "Unknown method" },
    });
  },
});
afterAll(() => server.stop(true));

async function cli(args: string[], env: Record<string, string> = {}) {
  const child = Bun.spawn([process.execPath, entry, ...args], {
    env: {
      ...process.env,
      EXCALIDRAW_MCP_URL: `http://127.0.0.1:${server.port}/mcp`,
      ...env,
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const deadline = setTimeout(() => child.kill(), 5000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { stdout, stderr, code };
  } finally {
    clearTimeout(deadline);
  }
}
function json(stdout: string) {
  return JSON.parse(stdout);
}

describe("bundled read-only CLI contract", () => {
  test("help and version work without a reachable or valid endpoint", async () => {
    const before = initialized;
    for (const args of [["--help"], ["describe", "--help"], ["--version"]]) {
      const result = await cli(args, { EXCALIDRAW_MCP_URL: "invalid" });
      expect(result.code).toBe(0);
      expect(result.stdout.length).toBeGreaterThan(0);
      expect(result.stderr).toBe("");
    }
    expect(initialized).toBe(before);
  });

  test("missing, unknown and duplicate arguments fail without contacting the server", async () => {
    const before = initialized;
    for (const args of [
      ["describe"],
      ["tools", "extra"],
      ["tools", "--bogus"],
      ["tools", "--timeout-ms", "0"],
      ["tools", "--timeout-ms", "50", "--timeout-ms", "60"],
      ["call"],
    ]) {
      const result = await cli(args);
      expect(result.code).toBe(2);
      expect(json(result.stdout).error.code).toBe("INVALID_ARGUMENT");
      expect(json(result.stdout).execution).toBe("not_attempted");
    }
    expect(initialized).toBe(before);
  });

  test("tools aggregates pages, sorts names and marks abbreviated descriptions", async () => {
    const result = await cli(["tools"]);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const payload = json(result.stdout);
    expect(payload.result.complete).toBe(true);
    expect(payload.result.count).toBe(2);
    expect(payload.result.tools.map((t: { name: string }) => t.name)).toEqual([
      "alpha",
      "zeta",
    ]);
    expect(payload.result.tools[0].description).toBe("中".repeat(200));
    expect(payload.result.tools[0].descriptionTruncated).toBe(true);
    expect(pageTwo).toBeGreaterThan(0);
    expect(targetCalls).toBe(0);
  });

  test("describe retains complete description/schema and stable fingerprint", async () => {
    const first = await cli(["describe", "alpha"]);
    const second = await cli(["describe", "alpha"]);
    expect(first.code).toBe(0);
    const info = json(first.stdout).result;
    expect(info.description).toBe("中".repeat(205));
    expect(info.inputSchema.required).toEqual(["value"]);
    expect(info.schemaHash).toMatch(/^[a-f0-9]{64}$/);
    expect(info.schemaHash).toBe(json(second.stdout).result.schemaHash);
    expect(info).not.toHaveProperty("outputSchema");
  });

  test("new server tools appear on the next invocation without rebuilding", async () => {
    const missing = await cli(["describe", "new_tool"]);
    expect(missing.code).toBe(3);
    expect(json(missing.stdout).error.code).toBe("TOOL_NOT_FOUND");
    added = true;
    try {
      const found = await cli(["describe", "new_tool"]);
      expect(found.code).toBe(0);
      expect(json(found.stdout).result.name).toBe("new_tool");
    } finally {
      added = false;
    }
  });

  test("explicit endpoint overrides environment and rejects malformed protocol data", async () => {
    const result = await cli(
      ["tools", "--endpoint", `http://127.0.0.1:${server.port}/broken`],
      { EXCALIDRAW_MCP_URL: "invalid" },
    );
    expect(result.code).toBe(4);
    expect(json(result.stdout).error.code).toBe("PROTOCOL_ERROR");
    expect(json(result.stdout)).not.toHaveProperty("result");
  });

  test("unauthorized endpoint fails without opening a login prompt", async () => {
    const result = await cli([
      "tools",
      "--endpoint",
      `http://127.0.0.1:${server.port}/auth`,
      "--timeout-ms",
      "1500",
    ]);
    expect(result.code).toBe(4);
    expect(json(result.stdout).error.code).toBe("AUTH_REQUIRED");
  });

  test("connection refusal is structured and nonzero", async () => {
    const result = await cli([
      "tools",
      "--endpoint",
      "http://127.0.0.1:1/mcp",
      "--timeout-ms",
      "1000",
    ]);
    expect(result.code).toBe(4);
    expect(json(result.stdout).error.code).toBe("CONNECTION_FAILED");
  });

  test("deadline covers a hanging initialize and the process actually exits", async () => {
    const started = Date.now();
    const result = await cli([
      "tools",
      "--endpoint",
      `http://127.0.0.1:${server.port}/stall`,
      "--timeout-ms",
      "100",
    ]);
    expect(result.code).toBe(6);
    expect(json(result.stdout).error.code).toBe("DEADLINE_EXCEEDED");
    expect(Date.now() - started).toBeLessThan(2000);
    expect(targetCalls).toBe(0);
  });
});
