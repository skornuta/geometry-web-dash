// Custom levels exported from the game as `.gmd` files (the editor's
// "export level", and GDShare's format): a plist dictionary of the level's
// `GJGameLevel` keys. What a play-through needs:
//
//   k2   the level name
//   k4   the level string (base64 + gzip, the same encoding as the main levels)
//   k8   the official song, 0-based (0 = Stereo Madness = main level 1)
//   k45  a custom (Newgrounds) song id — not available offline
//
// Both the plain `<d><k>..</k><s>..</s></d>` form and GD's own abbreviated
// `<dict><key>` form are accepted.

export interface CustomLevel {
  name: string;
  /** the level string, still encoded (see `decodeLevelString`) */
  data: string;
  /** main level whose song plays (official song k8 + 1), or null */
  songLevel: number | null;
  customSongId: number | null;
}

export function parseGmd(xml: string): CustomLevel {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const dict = doc.querySelector("d, dict");
  if (!dict) throw new Error("not a .gmd file (no plist dictionary)");
  const values = new Map<string, string>();
  const kids = Array.from(dict.children);
  for (let i = 0; i < kids.length - 1; i++) {
    const k = kids[i];
    if (k.tagName !== "k" && k.tagName !== "key") continue;
    const v = kids[i + 1];
    values.set(k.textContent ?? "", v.tagName === "t" || v.tagName === "true" ? "1" : (v.textContent ?? ""));
  }
  const data = values.get("k4");
  if (!data) throw new Error("the .gmd has no level data (k4)");
  const song = values.has("k8") ? parseInt(values.get("k8")!, 10) : 0;
  const custom = values.has("k45") ? parseInt(values.get("k45")!, 10) : 0;
  return {
    name: values.get("k2") || "Custom level",
    data,
    songLevel: custom > 0 ? null : (Number.isFinite(song) ? song + 1 : 1),
    customSongId: custom > 0 ? custom : null,
  };
}

const KEY = "gd-custom-level";

/** stash a dropped level for the `?custom=1` route (sessionStorage; survives the reload) */
export function storeCustomLevel(level: CustomLevel) {
  sessionStorage.setItem(KEY, JSON.stringify(level));
}
export function loadCustomLevel(): CustomLevel | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CustomLevel) : null;
  } catch { return null; }
}
