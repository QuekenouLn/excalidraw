import { run } from "./cli";

const result = await run(process.argv.slice(2));
const output =
  "json" in result ? `${JSON.stringify(result.json)}\n` : result.text;
// Exit after stdout is flushed: a timed-out transport must not keep the CLI alive.
process.stdout.on("error", () => process.exit(1));
process.stdout.write(output, () => process.exit(result.code));
