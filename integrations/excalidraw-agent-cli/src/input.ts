import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { CliError } from "./contract";

export const MAX_INPUT_BYTES = 16 * 1024 * 1024;

export async function readInput(
  path: string | undefined,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  if (!path) return {};
  if (path === "-" && process.stdin.isTTY) {
    throw new CliError(
      "INVALID_INPUT",
      2,
      "--input - requires piped stdin; interactive input is disabled.",
    );
  }
  if (path !== "-") {
    try {
      const info = await lstat(resolve(path));
      if (!info.isFile())
        throw new CliError(
          "INPUT_IO_ERROR",
          2,
          "Input must be a regular file.",
        );
      if (info.size > MAX_INPUT_BYTES)
        throw new CliError("INPUT_TOO_LARGE", 2, "Input exceeds 16 MiB.");
    } catch (error) {
      if (error instanceof CliError) throw error;
      throw new CliError("INPUT_IO_ERROR", 2, "Cannot read the input file.");
    }
  }
  signal.throwIfAborted();
  const stream = path === "-" ? process.stdin : createReadStream(resolve(path));
  const abort = () => stream.destroy(new Error("Input read cancelled."));
  signal.addEventListener("abort", abort, { once: true });
  const chunks: Buffer[] = [];
  let bytes = 0;
  let text: string;
  try {
    for await (const chunk of stream) {
      signal.throwIfAborted();
      const buffer = Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_INPUT_BYTES)
        throw new CliError("INPUT_TOO_LARGE", 2, "Input exceeds 16 MiB.");
      chunks.push(buffer);
    }
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks),
    );
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error instanceof CliError) throw error;
    throw new CliError(
      "INPUT_IO_ERROR",
      2,
      "Cannot read UTF-8 JSON from the input.",
    );
  } finally {
    signal.removeEventListener("abort", abort);
    stream.destroy();
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new CliError(
      "INVALID_INPUT",
      2,
      `Invalid JSON: ${error instanceof Error ? error.message : "parse error"}`,
      "Supply exactly one JSON object.",
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CliError("INVALID_INPUT", 2, "Input must be a JSON object.");
  }
  return value as Record<string, unknown>;
}
