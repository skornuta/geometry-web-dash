/**
 * "Report a bug": a plain page link over the canvas that opens a prefilled
 * GitHub issue on the public demo repository. It is deliberately DOM, not part
 * of the game's own UI, so the menus keep the original's layout.
 */

export const ISSUES_REPO = "skornuta/geometry-web-dash-demo";

export interface BugReportContext {
  /** `location.search` of the page, so the scene and level are recoverable */
  search: string;
  userAgent: string;
  /** canvas size in device pixels, then the device pixel ratio */
  canvas: { w: number; h: number; dpr: number };
}

/** The new-issue URL with a title stub and the facts a report always needs. */
export function bugReportUrl(c: BugReportContext): string {
  const body = [
    "**What happened?**",
    "",
    "",
    "**What did you expect?**",
    "",
    "",
    "**How to reproduce it** (level, what you pressed, which mode)",
    "",
    "",
    "---",
    "Filled in automatically, please keep:",
    `- page: \`${c.search || "/"}\``,
    `- browser: ${c.userAgent}`,
    `- canvas: ${c.canvas.w}x${c.canvas.h} @${c.canvas.dpr}x`,
  ].join("\n");
  const q = new URLSearchParams({ title: "[bug] ", body, labels: "bug" });
  return `https://github.com/${ISSUES_REPO}/issues/new?${q}`;
}

let link: HTMLAnchorElement | null = null;

/**
 * Mount the link once. `visible` is the starting state; gameplay starts hidden
 * and shows it only while paused (see `showBugReport`).
 */
export function mountBugReport(canvas: HTMLCanvasElement, visible: boolean) {
  if (link) return;
  const a = document.createElement("a");
  a.id = "bug-report";
  a.textContent = "Report a bug";
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  // out of the Tab order: the garage uses Tab, and a focused link would also
  // take Enter away from the game's own handlers
  a.tabIndex = -1;
  a.href = bugReportUrl(contextOf(canvas));
  // the canvas may have been resized since mount
  const refresh = () => { a.href = bugReportUrl(contextOf(canvas)); };
  a.addEventListener("pointerdown", refresh);
  a.addEventListener("click", (e) => { e.stopPropagation(); a.blur(); });
  Object.assign(a.style, {
    position: "fixed", left: "50%", bottom: "6px", transform: "translateX(-50%)",
    padding: "3px 10px", borderRadius: "10px", background: "rgba(0,0,0,.55)",
    color: "#fff", font: "600 12px/1.3 system-ui, sans-serif", textDecoration: "none",
    opacity: ".7", zIndex: "5", display: visible ? "block" : "none",
  } satisfies Partial<CSSStyleDeclaration>);
  a.addEventListener("pointerenter", () => { a.style.opacity = "1"; });
  a.addEventListener("pointerleave", () => { a.style.opacity = ".7"; });
  document.body.appendChild(a);
  link = a;
}

export function showBugReport(v: boolean) {
  if (link) link.style.display = v ? "block" : "none";
}

function contextOf(canvas: HTMLCanvasElement): BugReportContext {
  return {
    search: location.search,
    userAgent: navigator.userAgent,
    canvas: { w: canvas.width, h: canvas.height, dpr: window.devicePixelRatio || 1 },
  };
}
