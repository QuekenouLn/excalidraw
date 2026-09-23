import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { version } from "../package.json";

const directory = await mkdtemp(join(tmpdir(), "excalidraw-cli-install-"));
afterAll(() => rm(directory, { recursive: true, force: true }));
const installer = resolve(import.meta.dir, "../dist/install.js");
const bundle = resolve(import.meta.dir, "../dist/cli.js");
const root = join(directory, "space ' root");
const binDir = join(directory, "bin space");
const launcher = join(binDir, "excalidraw-agent-cli");
async function install(args: string[]) {
  const p = Bun.spawn(
    [process.execPath, installer, "--root", root, "--bin-dir", binDir, ...args],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { stdout, stderr, code };
}
function runInstalled() {
  return Bun.spawnSync([launcher, "--version"], {
    env: { PATH: "/usr/bin:/bin" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
}

test("installation is repeatable and launcher works with minimal PATH and quoted paths", async () => {
  for (let i = 0; i < 2; i++) {
    const result = await install(["--bundle", bundle]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).launcher).toBe(launcher);
  }
  const result = runInstalled();
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toString().trim()).toBe(version);
  expect(await readlink(join(root, "current"))).toBe(`releases/${version}`);
  expect(
    (await readFile(join(root, "current/install.js"))).length,
  ).toBeGreaterThan(0);
});

test("upgrade and rollback switch immutable releases; same-version replacement is rejected", async () => {
  const next = join(directory, "next.js");
  await writeFile(next, 'console.log("9.9.9");\n');
  expect((await install(["--bundle", next])).code).toBe(0);
  expect(runInstalled().stdout.toString().trim()).toBe("9.9.9");
  await writeFile(next, 'console.log("9.9.9"); // different bytes\n');
  const rejected = await install(["--bundle", next]);
  expect(rejected.code).toBe(1);
  expect(rejected.stderr).toContain("different contents");
  expect((await install(["--rollback"])).code).toBe(0);
  expect(runInstalled().stdout.toString().trim()).toBe(version);
  expect(await readlink(join(root, "previous"))).toBe("releases/9.9.9");
});

test("unmanaged launcher is never overwritten", async () => {
  const original = "#!/bin/sh\necho owned-by-user\n";
  await writeFile(launcher, original);
  const rejected = await install(["--bundle", bundle]);
  expect(rejected.code).toBe(1);
  expect(rejected.stderr).toContain("unmanaged launcher");
  expect(await readFile(launcher, "utf8")).toBe(original);
});
