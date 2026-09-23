import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const FILES = ["SKILL.md", "references/workflows.md"];
const exists = async (path: string) => {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
};

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    allowPositionals: true,
    options: {
      source: { type: "string" },
      home: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "bun install-skill.js --source <skill/excalidraw> [--home HOME]\nInstall one shared CLI Skill into OpenGrok/Claude/Agent discovery paths; archive replaced skills outside those paths. MCP configuration is not changed.",
    );
    return;
  }
  if (!values.source || positionals.length)
    throw new Error("--source DIR is required.");
  const home = resolve(values.home ?? homedir());
  const source = resolve(values.source);
  const contents = await Promise.all(
    FILES.map((path) => readFile(join(source, path), "utf8")),
  );
  if (
    !/^name: excalidraw$/m.test(contents[0]) ||
    !contents[0].includes("excalidraw-agent-cli")
  )
    throw new Error("Source is not the expected excalidraw CLI Skill.");
  const digest = createHash("sha256")
    .update(JSON.stringify(contents))
    .digest("hex");
  const base = join(home, ".local/share/excalidraw-agent-cli/skills");
  await mkdir(base, { recursive: true });
  const lock = join(base, ".install-lock");
  await mkdir(lock);
  const backups: { original: string; backup: string }[] = [];
  const target = join(base, digest.slice(0, 16), "excalidraw");
  const backupRoot = join(
    home,
    ".local/state/excalidraw-agent-cli/skill-backups",
    `${Date.now()}-${randomUUID().slice(0, 8)}`,
  );
  try {
    for (let i = 0; i < FILES.length; i++) {
      const path = join(target, FILES[i]);
      await mkdir(dirname(path), { recursive: true });
      if (await exists(path)) {
        if ((await readFile(path, "utf8")) !== contents[i])
          throw new Error(
            "Existing immutable Skill revision differs from its digest.",
          );
      } else {
        await writeFile(path, contents[i], { flag: "wx" });
      }
    }
    const entries = [
      [".agents/skills", "excalidraw-skill"],
      [".claude/skills", "excalidraw-skill"],
      [".opengrok/skills", "excalidraw"],
    ];
    for (const [relative, alias] of entries) {
      const directory = join(home, relative);
      await mkdir(directory, { recursive: true });
      for (const name of await readdir(directory)) {
        if (
          !["excalidraw", "excalidraw-skill"].includes(name) &&
          !/^excalidraw(?:-skill)?\.backup[.-]/.test(name)
        )
          continue;
        const original = join(directory, name);
        if (
          name === alias &&
          (await lstat(original)).isSymbolicLink() &&
          resolve(dirname(original), await readlink(original)) === target
        )
          continue;
        const backup = join(backupRoot, relative, name);
        await mkdir(dirname(backup), { recursive: true });
        await rename(original, backup);
        backups.push({ original, backup });
      }
      const entry = join(directory, alias);
      if (!(await exists(entry))) await symlink(target, entry, "dir");
    }
    const result = {
      ok: true,
      target,
      digest,
      backups,
      entries: entries.map(([directory, alias]) =>
        join(home, directory, alias),
      ),
    };
    if (backups.length)
      await writeFile(
        join(backupRoot, "manifest.json"),
        `${JSON.stringify(result, null, 2)}\n`,
      );
    console.log(JSON.stringify(result));
  } finally {
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
