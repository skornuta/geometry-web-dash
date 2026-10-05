// Decodes GD level files: urlsafe base64 -> gzip -> classic level string.
// Header: comma-separated kS## color channel / kA## settings pairs, then
// ";" separated objects as key,value,key,value...
// Works in node (tests) and the browser (DecompressionStream).
import { NO_HSV, parseHSV, type HSV } from "./color.ts";

export interface LevelObject {
  id: number;
  x: number;
  y: number;
  /** raw property map (string keys are the GD property numbers) */
  props: Map<number, string>;
}

export interface ColorChannel {
  r: number; g: number; b: number;
  /** player color index this channel copies (0 = none) */
  copyPlayerColor: number;
  opacity: number;
  blending: boolean;
  /** copied channel id (1.9+ "copy color" feature), 0 = none */
  copyChannel: number;
  copyOpacity: boolean;
  /** copy-colour HSV; `NO_HSV` when the channel copies its source verbatim */
  hsv: HSV;
}

export interface Level {
  colors: Map<number, ColorChannel>;
  bgColorChannel: number;
  groundColorChannel: number;
  lineColorChannel: number;
  objects: LevelObject[];
  rawHeader: string;
  /**
   * Background art, `kA6`: the `NN` of `game_bg_NN_001`. The header stores 0
   * for the default, which is art 01 — every classic level up to Clubstep (14)
   * leaves it 0, and they do all play on background 1 in the game.
   */
  bgStyle: number;
  /** ground art, `kA7`: the `NN` of `groundSquare_NN_001`, 0 read as 01 */
  groundStyle: number;
  /** middle-ground art, `kA25`: the `NN` of `fg_NN_001`; 0 is none (`m_middleGroundIndex`) */
  mgStyle: number;
}

export async function decodeLevelString(b64: string): Promise<Level> {
  let norm = b64
    .replace(/[\x00-\x1f]/g, "") // strip control chars (22.txt is wrapped in NULs)
    .replace(/-/g, "+").replace(/_/g, "/");
  norm += "=".repeat((4 - (norm.length % 4)) % 4);
  const bytes = Uint8Array.from(atob(norm), (c) => c.charCodeAt(0));
  // DecompressionStream exists in modern browsers AND node >= 18
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const data = await new Response(stream).text();
  return parseLevelString(data);
}

export function parseLevelString(data: string): Level {
  const parts = data.split(";");
  const header = parts[0];
  const level: Level = {
    colors: new Map(),
    bgColorChannel: 1000,
    groundColorChannel: 1001,
    lineColorChannel: 1002,
    objects: [],
    rawHeader: header,
    bgStyle: 1,
    groundStyle: 1,
    mgStyle: 0,
  };

  // --- header ---
  // Pre-2.0 color keys (all 22 main levels use these; 2.x levels may also add kS38):
  // kS29->1000 BG, kS30->1001 G1, kS31->1002 LINE, kS32->1004 OBJ,
  // kS33->1 COL1, kS34->2 COL2, kS35->3 COL3, kS36->4 COL4, kS37->1003 3DL
  const KS_CHANNEL: Record<number, number> = {
    29: 1000, 30: 1001, 31: 1002, 32: 1004, 33: 1, 34: 2, 35: 3, 36: 4, 37: 1003,
  };
  const kv = header.split(",");
  for (let i = 0; i + 1 < kv.length; i += 2) {
    const key = kv[i], val = kv[i + 1];
    if (key === "kA6") level.bgStyle = Math.max(1, parseInt(val, 10) || 0);
    if (key === "kA7") level.groundStyle = Math.max(1, parseInt(val, 10) || 0);
    if (key === "kA25") level.mgStyle = Math.max(0, parseInt(val, 10) || 0);
    const m = /^kS(\d+)$/.exec(key);
    if (m) {
      const ch = KS_CHANNEL[parseInt(m[1], 10)];
      if (ch !== undefined && val) level.colors.set(ch, parseColorString(val));
    }
    // kS38 is the 2.0 colour list: `|`-separated entries, each naming its own
    // channel. Levels 19-22 use ONLY this — without it they parse zero channels
    // and every object, the ground and the background fall back to black.
    if (key === "kS38" && val) {
      for (const entry of val.split("|")) {
        if (!entry) continue;
        const c = parseColorString(entry, true);
        const ch = parseInt(entryKey(entry, 6) ?? "-1", 10);
        if (Number.isFinite(ch) && ch >= 0) level.colors.set(ch, c);
      }
    }
  }

  // --- objects ---
  for (let i = 1; i < parts.length; i++) {
    const s = parts[i];
    if (!s) continue;
    const arr = s.split(",");
    const props = new Map<number, string>();
    for (let j = 0; j + 1 < arr.length; j += 2) {
      props.set(parseInt(arr[j], 10), arr[j + 1]);
    }
    const id = parseInt(props.get(1) ?? "0", 10);
    const x = parseFloat(props.get(2) ?? "0");
    const y = parseFloat(props.get(3) ?? "0");
    level.objects.push({ id, x, y, props });
  }
  return level;
}

/** read one `k_v` pair out of an underscore-separated colour string */
function entryKey(s: string, key: number): string | undefined {
  const arr = s.split("_");
  for (let i = 0; i + 1 < arr.length; i += 2) {
    if (parseInt(arr[i], 10) === key) return arr[i + 1];
  }
  return undefined;
}

/**
 * Underscore-separated `k_v` colour string.
 *
 * The two eras disagree on two keys and getting them crossed silently produces
 * black levels:
 * | key | legacy (kS29-37) | 2.0 (kS38) |
 * |-----|------------------|------------|
 * | 6   | **opacity**      | **channel id** |
 * | 7   | -                | **opacity** |
 * | 10 / 17 | copy opacity | **copy HSV** (10) / copy opacity (17) |
 */
function parseColorString(s: string, twoPointOh = false): ColorChannel {
  const arr = s.split("_");
  const m = new Map<number, string>();
  for (let i = 0; i + 1 < arr.length; i += 2) m.set(parseInt(arr[i], 10), arr[i + 1]);
  const c: ColorChannel = {
    r: parseInt(m.get(1) ?? "255", 10),
    g: parseInt(m.get(2) ?? "255", 10),
    b: parseInt(m.get(3) ?? "255", 10),
    copyPlayerColor: parseInt(m.get(4) ?? "0", 10),
    opacity: parseFloat((twoPointOh ? m.get(7) : m.get(6)) ?? "1"),
    blending: m.get(5) === "1",
    copyChannel: parseInt(m.get(9) ?? "0", 10),
    copyOpacity: (twoPointOh ? m.get(17) : m.get(10)) === "1",
    // key 10 is copy-opacity in the legacy era and the copy HSV in 2.0 — the
    // same crossed-keys trap as key 6
    hsv: twoPointOh && m.has(10) ? parseHSV(m.get(10)!) : NO_HSV,
  };
  return c;
}

