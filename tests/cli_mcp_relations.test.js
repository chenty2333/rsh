import test from "node:test";
import assert from "node:assert/strict";
import { runCli, tempWorkspace } from "./helpers.js";

test("CLI documents and enforces three-character lowercase base36 IDs", () => {
  const root = tempWorkspace("cli-base36-ids");
  const help = runCli(root, ["help"]).stdout;
  assert.match(help, /Q-abc, D-4z1, or R-a9z/);
  assert.match(help, /for example R-a9z/);

  for (const id of ["Q-abcd", "R-ffff", "D-A1z", "R-ab_"]) {
    const result = runCli(root, ["get", id], { success: false });
    assert.match(result.stderr, /exactly 3 lowercase base36 characters/);
  }
  const wrongKind = runCli(root, ["mark", "Q-abc", "checked"], { success: false });
  assert.match(wrongKind.stderr, /Record ID must be R-/);
});
