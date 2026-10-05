// Send one command to the gd-ui-capture Geode mod running inside native GD and
// wait for its acknowledgement.
//
//   node scripts/native-cmd.mjs play 12
//   node scripts/native-cmd.mjs trace /tmp/gd-ui-capture/trace-12.txt
//   node scripts/native-cmd.mjs seek 2326
//   node scripts/native-cmd.mjs shot /tmp/gd-ui-capture/l12-2326.png
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const [cmd, arg = ""] = process.argv.slice(2);
if (!cmd) throw new Error("usage: native-cmd.mjs <command> [arg]");
mkdirSync("/tmp/gd-ui-capture", { recursive: true });
const seq = `${Date.now()}`;
writeFileSync("/tmp/gd-ui-capture/cmd", `${seq} ${cmd} ${arg}\n`);
const deadline = Date.now() + 120_000;
for (;;) {
  let ack = "";
  try { ack = readFileSync("/tmp/gd-ui-capture/ack", "utf8").trim(); } catch {}
  if (ack.startsWith(`${seq} `)) {
    console.log(ack.slice(seq.length + 1));
    process.exit(ack.startsWith(`${seq} ok`) ? 0 : 1);
  }
  if (Date.now() > deadline) { console.error("no answer from the mod — is GD running?"); process.exit(2); }
  await new Promise((r) => setTimeout(r, 100));
}
