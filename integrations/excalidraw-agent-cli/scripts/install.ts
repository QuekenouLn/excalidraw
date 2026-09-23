import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const MARKER = "# Managed by excalidraw-agent-cli installer";
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
const exists = async (path: string) => {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
};
async function readReleaseLink(path: string): Promise<string | undefined> {
  if (!(await exists(path))) return undefined;
  const target = await readlink(path);
  if (!/^releases\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(target))
    throw new Error("Unexpected release link; refusing to replace it.");
  return target;
}
async function setLink(path: string, target: string) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await symlink(target, temporary);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    allowPositionals: true,
    options: {
      bundle: { type: "string" },
      root: { type: "string" },
      "bin-dir": { type: "string" },
      rollback: { type: "boolean" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "Install: bun install.js --bundle cli.js [--root DIR] [--bin-dir DIR]\nRollback: bun install.js --rollback [--root DIR] [--bin-dir DIR]\nNo dependencies are downloaded. The current Bun executable is pinned in the launcher.",
    );
    return;
  }
  if (positionals.length || (values.rollback ? values.bundle : !values.bundle))
    throw new Error("Supply --bundle FILE or --rollback.");
  const root = resolve(
    values.root ?? join(homedir(), ".local/share/excalidraw-agent-cli"),
  );
  const binDir = resolve(values["bin-dir"] ?? join(homedir(), ".local/bin"));
  const launcher = join(binDir, "excalidraw-agent-cli");
  if (await exists(launcher)) {
    if (
      !(await lstat(launcher)).isFile() ||
      !(await readFile(launcher, "utf8")).includes(MARKER)
    ) {
      throw new Error(
        "An unmanaged launcher already exists; refusing to overwrite it.",
      );
    }
  }
  await mkdir(root, { recursive: true });
  const lock = join(root, ".install-lock");
  await mkdir(lock); // Exclusive lock. Never remove somebody else's lock.
  let staging: string | undefined;
  try {
    const current = await readReleaseLink(join(root, "current"));
    const previous = await readReleaseLink(join(root, "previous"));
    let target: string;
    if (values.rollback) {
      if (!previous)
        throw new Error(
          "No previous installed release is available for rollback.",
        );
      if (!(await exists(join(root, previous, "cli.js"))))
        throw new Error("Previous release bundle is missing.");
      target = previous;
    } else {
      const bundle = resolve(values.bundle!);
      const probe = Bun.spawnSync([process.execPath, bundle, "--version"], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        timeout: 10000,
      });
      const version = probe.stdout.toString().trim();
      if (
        probe.exitCode !== 0 ||
        !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)
      )
        throw new Error(
          "Bundle did not return a valid version under the selected Bun runtime.",
        );
      const bytes = await readFile(bundle);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      target = `releases/${version}`;
      const release = join(root, target);
      if (await exists(release)) {
        const existingHash = createHash("sha256")
          .update(await readFile(join(release, "cli.js")))
          .digest("hex");
        if (existingHash !== sha256)
          throw new Error(
            "This version is already installed with different contents. Bump the version instead of replacing it.",
          );
      } else {
        await mkdir(join(root, "releases"), { recursive: true });
        staging = join(root, "releases", `.staging-${randomUUID()}`);
        await mkdir(staging);
        await writeFile(join(staging, "cli.js"), bytes, { mode: 0o644 });
        await writeFile(
          join(staging, "install.js"),
          await readFile(import.meta.path),
          { mode: 0o644 },
        );
        await writeFile(
          join(staging, "manifest.json"),
          `${JSON.stringify(
            {
              version,
              sha256,
              bun: process.execPath,
              installedAt: new Date().toISOString(),
            },
            null,
            2,
          )}\n`,
        );
        await rename(staging, release);
        staging = undefined;
      }
    }
    await mkdir(binDir, { recursive: true });
    const launcherText = `#!/bin/sh\n${MARKER}\nexec ${quote(
      process.execPath,
    )} ${quote(join(root, "current/cli.js"))} "$@"\n`;
    const temporaryLauncher = join(
      binDir,
      `.excalidraw-agent-cli-${randomUUID()}.tmp`,
    );
    try {
      await writeFile(temporaryLauncher, launcherText, {
        flag: "wx",
        mode: 0o755,
      });
      await chmod(temporaryLauncher, 0o755);
      if (current && current !== target)
        await setLink(join(root, "previous"), current);
      await setLink(join(root, "current"), target);
      await rename(temporaryLauncher, launcher);
    } finally {
      await rm(temporaryLauncher, { force: true });
    }
    console.log(
      JSON.stringify({
        ok: true,
        action: values.rollback ? "rollback" : "install",
        launcher,
        release: join(root, target),
        bun: process.execPath,
        previous: current !== target ? current ?? null : previous ?? null,
      }),
    );
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    await rm(lock, { recursive: true });
  }
}
try {
  await main();
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
}
