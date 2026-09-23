import { afterAll, expect, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  readlink,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const home = await mkdtemp(join(tmpdir(), "excalidraw-skill-install-"));
afterAll(() => rm(home, { recursive: true, force: true }));
const source = resolve(import.meta.dir, "../skill/excalidraw");
const installer = resolve(import.meta.dir, "../dist/install-skill.js");
async function install() {
  const p = Bun.spawn(
    [process.execPath, installer, "--source", source, "--home", home],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  expect(code).toBe(0);
  expect(stderr).toBe("");
  return JSON.parse(stdout);
}

test("legacy duplicate skills and in-discovery backups are preserved outside discovery", async () => {
  for (const path of [
    ".agents/skills/excalidraw-skill",
    ".claude/skills/excalidraw-skill",
    ".claude/skills/excalidraw-skill.backup-old",
  ]) {
    await mkdir(join(home, path), { recursive: true });
    await writeFile(join(home, path, "SKILL.md"), "legacy-native-mcp");
  }
  const result = await install();
  expect(result.backups).toHaveLength(3);
  for (const b of result.backups)
    expect(await readFile(join(b.backup, "SKILL.md"), "utf8")).toBe(
      "legacy-native-mcp",
    );
  for (const entry of result.entries)
    expect(await readlink(entry)).toBe(result.target);
  expect(await readdir(join(home, ".claude/skills"))).toEqual([
    "excalidraw-skill",
  ]);
  expect(await readFile(join(result.target, "SKILL.md"), "utf8")).toContain(
    "excalidraw-agent-cli",
  );
  expect(
    await readFile(join(result.target, "references/workflows.md"), "utf8"),
  ).toContain("expectedRevision");
});

test("reinstalling the same skill creates no additional backups or divergent copies", async () => {
  const result = await install();
  expect(result.backups).toEqual([]);
  for (const entry of result.entries)
    expect(await readlink(entry)).toBe(result.target);
});
