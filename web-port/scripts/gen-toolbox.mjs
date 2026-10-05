// Extracts the game's own object-id -> sprite-frame table out of the shipping
// binary, into data/toolbox-frames.json (gitignored; the derived table is what
// gets committed, via gen-objects.mjs).
//
// WHY THIS EXISTS
// ---------------
// `gen-objects.mjs` maps ids with OpenGD's Content/Custom/object.json, which is
// a 2.1-era reimplementation: it covers 791 of the 1055 ids the 22 levels use,
// and `scripts/audit.mjs` measured what that costs — **17080 of 175138 objects
// (9.75%) never drawn at all**, 63% of level 22.
//
// The real table is not a community file. It is `ObjectToolbox::m_allKeys`,
// built by `ObjectToolbox::init()`, which the game consults through
// `intKeyToFrame(id)` — `GameObject::createWithKey` calls it before it does
// anything else. `init()` is 691208 bytes of inlined
// `m_allKeys[<id>] = "<frame>.png"`, so the whole table can be read straight
// out of the disassembly. **4092 ids**, against OpenGD's 791.
//
// It agrees with `objects.ts` on **731 of the 791 ids the two share (92.4%)**,
// including every id this project pinned the hard way — the six orbs, the four
// pads, the coin, the dash rings. That agreement is what makes it trustworthy;
// it also settles two things earlier sessions could not:
//   * id **747** is `portal_15_front_001.png`, not the `portal_18` in EXTRA.
//   * id **1594** is `ring_custom_01_001.png` — neither of the two candidates
//     ("spiderBump" / "spiderRing") gen-objects.mjs refused to choose between.
//
// THE `edit_` RULE — the useful half of the result
// ------------------------------------------------
// The toolbox frame is what the **editor's object button** shows. For ordinary
// art that is the sprite itself; for triggers and other invisible objects it is
// an editor icon, and those all begin `edit_`. So the prefix separates
// "invisible on purpose" from "art we are failing to draw":
//   * 80 ids / 5965 objects are `edit_*` — colour (29/30/105/899/744), pulse
//     (1006), move (901), alpha (1007), spawn (1268), toggle (1049), the old
//     enter-effect triggers (22-28, 55-59). Correctly invisible.
//   * 180 ids / 10814 objects are real art — level 22's `pixelart_*`, level
//     21's `GJBeast01_*` and `dA_blackSludge_*`.
// Only 4 used ids (104, 221, 717, 718 — 301 objects) are in neither table.
//
// Usage:  npm run gen:toolbox        (needs the game installed on this machine)
//
// Pipeline notes and the address-DB version trap: see PHYSICS-FROM-BINARY.md.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "data", "toolbox-frames.json");

const BINARY = path.join(
  os.homedir(),
  "Library/Application Support/Steam/steamapps/common/Geometry Dash",
  "Geometry Dash.app/Contents/MacOS/Geometry Dash",
);
/** fat-binary offset of the arm64 slice (see PHYSICS-FROM-BINARY.md) */
const SLICE_OFFSET = 11026432;
const SLICE_LENGTH = 9996432;
/** geode 2.2081: ObjectToolbox::init, and how far it runs */
const INIT_ADDR = 0x589140;
const INIT_LENGTH = 691300;
const VMBASE = 0x100000000;

function extractSlice(dest) {
  const fd = fs.openSync(BINARY, "r");
  try {
    const buf = Buffer.alloc(SLICE_LENGTH);
    fs.readSync(fd, buf, 0, SLICE_LENGTH, SLICE_OFFSET);
    // MH_MAGIC_64 + CPU_TYPE_ARM64: if this fails the install moved or changed
    if (buf.readUInt32LE(0) !== 0xfeedfacf || buf.readUInt32LE(4) !== 0x0100000c) {
      throw new Error("not an arm64 Mach-O at the expected fat offset — see PHYSICS-FROM-BINARY.md");
    }
    fs.writeFileSync(dest, buf);
  } finally {
    fs.closeSync(fd);
  }
}

function disassemble(slice, addr, length) {
  return execFileSync("lldb", [
    "--batch",
    "-o", `target create --arch arm64 ${slice}`,
    "-o", `disassemble --start-address ${VMBASE + addr} --end-address ${VMBASE + addr + length}`,
  ], { maxBuffer: 1 << 30, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

/**
 * One table entry compiles to a red-black-tree insert followed by the string
 * assignment:
 *
 *     mov  w25, #0x40             ; the id, in whatever register is free
 *     str  w25, [x0, #0x20]       ; ...stored into the new node's key
 *     add  x1, x1, #0x52f         ; "square_b_02_001.png"
 *     bl   ...basic_string::assign(char const*)
 *
 * **Track the key per register.** A parser that just remembers the last
 * `mov w8, #imm` gets two entries wrong: the key register varies, and
 * `mov w0, #0x40` — `operator new(64)`, which precedes every insert — collides
 * with id 64. Keyed by register, the parse is exact: 4093 assignments, 4092
 * distinct ids, zero conflicts, zero unresolved stores.
 */
function parse(text) {
  const reMov = /\bmov\s+w(\d+), #(0x[0-9a-f]+|-?\d+)/;
  const reMovk = /\bmovk\s+w(\d+), #(0x[0-9a-f]+|\d+)(?:, lsl #(\d+))?/;
  const reStore = /\bstr\s+w(\d+), \[x0, #0x20\]/;
  const reFrame = /\badd\s+x1, x1, #0x[0-9a-f]+\s+;\s+"([^"]*)"/;
  const reAssign = /symbol stub for: std::__1::basic_string.*assign/;

  const regs = new Map();
  const table = new Map();
  let key = null, frame = null, unresolved = 0, assigns = 0, conflicts = 0;

  for (const line of text.split("\n")) {
    let m = reMov.exec(line);
    if (m) regs.set(m[1], Number(m[2]));
    m = reMovk.exec(line);
    if (m) {
      const shift = Number(m[3] ?? 0);
      const prev = regs.get(m[1]) ?? 0;
      regs.set(m[1], (prev & ~(0xffff << shift)) | (Number(m[2]) << shift));
    }
    m = reStore.exec(line);
    if (m) {
      if (regs.has(m[1])) key = regs.get(m[1]);
      else unresolved++;
    }
    m = reFrame.exec(line);
    if (m) frame = m[1];
    if (reAssign.test(line)) {
      assigns++;
      if (key === null || frame === null) continue;
      if (table.has(key) && table.get(key) !== frame) conflicts++;
      else table.set(key, frame);
    }
  }
  return { table, assigns, unresolved, conflicts };
}

function main() {
  if (!fs.existsSync(BINARY)) {
    console.error(`game binary not found at:\n  ${BINARY}\n`
      + "This generator reads the shipping game; nothing to do without it.");
    process.exit(1);
  }
  const slice = path.join(os.tmpdir(), "gd-arm64-slice");
  process.stderr.write("extracting arm64 slice…\n");
  extractSlice(slice);
  process.stderr.write("disassembling ObjectToolbox::init (691 KB)…\n");
  const text = disassemble(slice, INIT_ADDR, INIT_LENGTH);
  if (!/square_01_001\.png/.test(text)) {
    throw new Error("id 1 is not square_01 — wrong address, or the game updated. "
      + "Re-pin ObjectToolbox::init against the matching geode bindings first.");
  }
  const { table, assigns, unresolved, conflicts } = parse(text);
  if (unresolved || conflicts) {
    throw new Error(`parse is not exact: ${unresolved} unresolved keys, ${conflicts} conflicts`);
  }
  if (table.size < 4000) throw new Error(`only ${table.size} ids — the dump was truncated`);

  const sorted = Object.fromEntries([...table].sort((a, b) => a[0] - b[0]));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(sorted, null, 0));
  const editor = [...table.values()].filter((f) => f.startsWith("edit_")).length;
  console.log(`${table.size} ids from ${assigns} assignments `
    + `(${editor} editor icons, ${table.size - editor} art) -> ${path.relative(ROOT, OUT)}`);
}

main();
