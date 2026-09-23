import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  open,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { CliError, type Envelope } from "./contract";

export const MAX_STDOUT_BYTES = 64 * 1024;
export type Destination = {
  target: string;
  temporary: string;
  handle: FileHandle;
};

export async function reserveOutput(path: string): Promise<Destination> {
  const target = resolve(path);
  try {
    await lstat(target);
    throw new CliError(
      "OUTPUT_EXISTS",
      7,
      "The output file already exists; choose a new path.",
    );
  } catch (error) {
    if (error instanceof CliError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw new CliError(
        "OUTPUT_IO_ERROR",
        7,
        "Cannot inspect the output path.",
      );
    }
  }
  const temporary = join(
    dirname(target),
    `.${basename(target)}.${randomUUID()}.tmp`,
  );
  try {
    return { target, temporary, handle: await open(temporary, "wx", 0o600) };
  } catch {
    throw new CliError(
      "OUTPUT_IO_ERROR",
      7,
      "Cannot create a result file in the output directory.",
      "Choose an existing writable directory.",
    );
  }
}

export async function discardOutput(destination?: Destination): Promise<void> {
  if (!destination) return;
  await destination.handle.close().catch(() => {});
  await unlink(destination.temporary).catch(() => {});
}

async function save(destination: Destination, payload: string): Promise<void> {
  try {
    await destination.handle.writeFile(payload, "utf8");
    await destination.handle.sync();
    await destination.handle.close();
    // Atomic, no-clobber publication. Never rename over an existing user's file.
    await link(destination.temporary, destination.target);
  } finally {
    await discardOutput(destination);
  }
}

async function autoDestination(): Promise<Destination> {
  const directory = join(
    homedir(),
    ".local/state/excalidraw-agent-cli/results",
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  return reserveOutput(join(directory, `result-${randomUUID()}.json`));
}

function summary(
  original: Envelope,
  destination: Destination,
  payload: string,
) {
  const { result: _result, ...base } = original;
  return {
    ...base,
    resultFile: destination.target,
    bytes: Buffer.byteLength(payload),
    sha256: createHash("sha256").update(payload).digest("hex"),
  };
}

export async function deliver(
  json: Envelope,
  code: number,
  explicit?: Destination,
): Promise<{ json: Envelope; code: number }> {
  const payload = `${JSON.stringify(json)}\n`;
  if (!explicit && Buffer.byteLength(payload) <= MAX_STDOUT_BYTES)
    return { json, code };
  let destination = explicit;
  try {
    destination ??= await autoDestination();
    await save(destination, payload);
    return { json: summary(json, destination, payload), code };
  } catch (error) {
    const failure =
      (error as NodeJS.ErrnoException).code === "EEXIST"
        ? "OUTPUT_EXISTS"
        : "OUTPUT_IO_ERROR";
    let recovered: ReturnType<typeof summary> | undefined;
    try {
      const fallback = await autoDestination();
      await save(fallback, payload);
      recovered = summary(json, fallback, payload);
    } catch {
      /* Report the operation state even if no storage is writable. */
    }
    const { result: _result, ...base } = json;
    const diagnostic = {
      ...(recovered ?? base),
      ok: false,
      operationOk: json.ok,
      ...(json.error ? { operationError: json.error } : {}),
      error: {
        code: failure,
        message: recovered
          ? "Output delivery failed; the complete result was saved to resultFile."
          : "Output delivery failed and no fallback file could be saved.",
        hint: "Do not repeat a write because output failed. Inspect resultFile if present, or read the remote state.",
      },
    };
    return { json: diagnostic, code: 7 };
  }
}
