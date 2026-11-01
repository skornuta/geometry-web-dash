import { test } from "node:test";
import assert from "node:assert/strict";
import { bugReportUrl, ISSUES_REPO } from "../src/bugReport.ts";

const ctx = { search: "?level=3", userAgent: "UA/1.0", canvas: { w: 1768, h: 992, dpr: 2 } };

test("the report opens a new issue on the public demo repo", () => {
  const u = new URL(bugReportUrl(ctx));
  assert.equal(u.origin + u.pathname, `https://github.com/${ISSUES_REPO}/issues/new`);
  assert.equal(u.searchParams.get("labels"), "bug");
  assert.ok(u.searchParams.get("title")!.startsWith("[bug]"));
});

test("the body carries the page, browser and canvas size for reproduction", () => {
  const body = new URL(bugReportUrl(ctx)).searchParams.get("body")!;
  assert.match(body, /page: `\?level=3`/);
  assert.match(body, /browser: UA\/1\.0/);
  assert.match(body, /canvas: 1768x992 @2x/);
  assert.match(body, /How to reproduce/);
});

test("the root page is reported as /, not an empty string", () => {
  const body = new URL(bugReportUrl({ ...ctx, search: "" })).searchParams.get("body")!;
  assert.match(body, /page: `\/`/);
});
