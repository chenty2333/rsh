import test from "node:test";
import assert from "node:assert/strict";
import { runCli, tempWorkspace } from "./helpers.js";

test("CLI documents five-character generated IDs and accepts legacy three-character IDs", () => {
  const root = tempWorkspace("cli-base36-ids");
  const help = runCli(root, ["help"]).stdout;
  assert.match(help, /Q-00000, D-00001, or R-00002/);
  assert.match(help, /legacy 3-digit IDs also work/);

  for (const id of ["Q-abcd", "R-ffffff", "D-A1z", "R-ab_"]) {
    const result = runCli(root, ["get", id], { success: false });
    assert.match(result.stderr, /exactly 3 or 5 lowercase base36 characters/);
  }
  const wrongKind = runCli(root, ["mark", "Q-abc", "checked"], { success: false });
  assert.match(wrongKind.stderr, /Record ID must be R-/);
});
