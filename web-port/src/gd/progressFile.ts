/**
 * The save file: export the whole save as one JSON file, and load one back.
 *
 * There is no login and no network call: the file is the save, written to and
 * read from the player's own disk.
 *
 * File format (version 1):
 *   { "format": "gd-web-save-file", "version": 1, "save": { v, levels, settings, icons } }
 *
 * Import is all or nothing. The whole file is validated first, and a file that
 * fails any check is refused with a reason, leaving the current save and its
 * storage untouched. Only an accepted file replaces the save, and the page then
 * reloads, because scenes keep references to `save.settings()`.
 *
 * Refused, not coerced: a wrong type or an out-of-range value is an error, not a
 * silently repaired field. A field that is simply absent is accepted, and takes
 * its default when the save is loaded (`save.loadFrom` runs the same migration
 * as storage does).
 */

import { ICON_COUNTS, ICON_TABS, PLAYER_COLORS } from "./icons.ts";
import * as save from "./save.ts";
import { SETTINGS_KEYS, type SaveData } from "./save.ts";

export const SAVE_FILE_NAME = "geometry-dash-save.json";
export const SAVE_FORMAT = "gd-web-save-file";
const FILE_VERSION = 1;

/** the file text for a save: the four fields the save holds, under the envelope */
export function exportSave(data: SaveData): string {
  return JSON.stringify({
    format: SAVE_FORMAT,
    version: FILE_VERSION,
    save: { v: data.v, levels: data.levels, settings: data.settings, icons: data.icons },
  }, null, 2);
}

export type ParseResult =
  | { ok: true; data: SaveData }
  | { ok: false; reason: string };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isFiniteCount = (v: unknown): boolean =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;
const isUnit = (v: unknown): boolean =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
const isIntIn = (v: unknown, lo: number, hi: number): boolean =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

/** the first problem with `s`, as a sentence, or null when every present field is valid */
function checkSave(s: Record<string, unknown>): string | null {
  if (s.v !== undefined && typeof s.v !== "number") return "save.v must be a number";

  if (s.levels !== undefined) {
    if (!isObject(s.levels)) return "levels must be an object";
    for (const [key, entry] of Object.entries(s.levels)) {
      if (!isObject(entry)) return `levels.${key} must be an object`;
      for (const f of ["normal", "practice", "attempts", "jumps"] as const) {
        if (entry[f] !== undefined && !isFiniteCount(entry[f])) {
          return `levels.${key}.${f} must be a number, 0 or more`;
        }
      }
      if (entry.coins !== undefined) {
        if (!Array.isArray(entry.coins) || !entry.coins.every((c) => isIntIn(c, 0, 2))) {
          return `levels.${key}.coins must be a list of whole numbers from 0 to 2`;
        }
      }
    }
  }

  if (s.settings !== undefined) {
    if (!isObject(s.settings)) return "settings must be an object";
    for (const k of SETTINGS_KEYS) {
      const v = s.settings[k];
      if (v === undefined) continue;
      if (k === "musicVolume" || k === "sfxVolume") {
        if (!isUnit(v)) return `settings.${k} must be a number from 0 to 1`;
      } else if (typeof v !== "boolean") {
        return `settings.${k} must be true or false`;
      }
    }
  }

  if (s.icons !== undefined) {
    if (!isObject(s.icons)) return "icons must be an object";
    for (const m of ICON_TABS) {
      const v = s.icons[m];
      if (v !== undefined && !isIntIn(v, 1, ICON_COUNTS[m])) {
        return `icons.${m} must be a whole number from 1 to ${ICON_COUNTS[m]}`;
      }
    }
    const top = PLAYER_COLORS.length - 1;
    for (const c of ["col1", "col2"] as const) {
      const v = s.icons[c];
      if (v !== undefined && !isIntIn(v, 0, top)) {
        return `icons.${c} must be a colour from 0 to ${top}`;
      }
    }
    if (s.icons.glow !== undefined && typeof s.icons.glow !== "boolean") {
      return "icons.glow must be true or false";
    }
  }

  return null;
}

/**
 * Validate a save file's text. Pure: it reads the text and returns either the
 * file's save, with absent fields still absent, or a reason. It never touches
 * the save; `applySaveText` does that, and only for an accepted file.
 */
export function parseSaveFile(text: string): ParseResult {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, reason: "the file is not valid JSON" };
  }
  if (!isObject(doc)) return { ok: false, reason: "the file's top level is not an object" };
  if (doc.format !== SAVE_FORMAT) return { ok: false, reason: "this is not a Geometry Dash save file" };
  if (doc.version !== FILE_VERSION) {
    return { ok: false, reason: `save file version ${String(doc.version)} is not supported` };
  }
  if (!isObject(doc.save)) return { ok: false, reason: "the file has no save object" };
  const problem = checkSave(doc.save);
  if (problem) return { ok: false, reason: problem };
  return { ok: true, data: doc.save as unknown as SaveData };
}

/**
 * Parse a file and, only if it is accepted, make it the save: `loadFrom`, then
 * `flush` to storage, then `reload` so the scenes pick the new values up.
 * A refused file changes nothing and does not reload.
 */
export function applySaveText(
  text: string, reload: () => void,
): { ok: true } | { ok: false; reason: string } {
  const r = parseSaveFile(text);
  if (!r.ok) return r;
  save.loadFrom(r.data);
  save.flush();
  reload();
  return { ok: true };
}

/* ---------------- browser glue (thin; not unit-tested) ---------------- */

/** Export button: a JSON Blob handed to a temporary anchor's download */
export function downloadSaveFile(): void {
  const blob = new Blob([exportSave(save.save())], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = SAVE_FILE_NAME;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Load button: a hidden file input, read with `file.text()`, then applied */
export function openSaveFilePicker(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    let text: string;
    try {
      text = await file.text();
    } catch {
      window.alert("The save file could not be read. Your save was not changed.");
      return;
    }
    const r = applySaveText(text, () => window.location.reload());
    if (!r.ok) {
      window.alert(`That is not a valid save file: ${r.reason}. Your save was not changed.`);
    }
  };
  input.click();
}
