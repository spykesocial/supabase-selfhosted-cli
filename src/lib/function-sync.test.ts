import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findPrunableRemoteEntries } from "./function-sync.js";

describe("findPrunableRemoteEntries", () => {
  it("returns remote names that do not exist locally", () => {
    const prunable = findPrunableRemoteEntries(
      [
        { name: "main", isDirectory: true },
        { name: "clients", isDirectory: true },
      ],
      ["main", "clients", "selfhosted-deploy-test"],
    );

    assert.deepEqual(prunable, ["selfhosted-deploy-test"]);
  });

  it("returns an empty list when remote matches local", () => {
    const prunable = findPrunableRemoteEntries(
      [{ name: "main", isDirectory: true }],
      ["main"],
    );

    assert.deepEqual(prunable, []);
  });
});
