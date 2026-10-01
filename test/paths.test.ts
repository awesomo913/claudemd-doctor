import { describe, expect, it } from "vitest";
import { ancestorDirsRootFirst, slugify } from "../src/core/paths.js";
import path from "node:path";

describe("slugify", () => {
  it("replaces drive-letter colon and backslashes with dashes, no collapsing", () => {
    // Verified against real ~/.claude/projects directory names on the dev
    // machine: cwd "C:\\" -> slug "C--"; cwd "C:\\StolenEmerald" -> "C--StolenEmerald".
    expect(slugify("C:\\")).toBe("C--");
    expect(slugify("C:\\StolenEmerald")).toBe("C--StolenEmerald");
  });

  it("replaces forward slashes too (posix cwd)", () => {
    expect(slugify("/home/user/project")).toBe("-home-user-project");
  });

  it("does not merge consecutive separators into one dash", () => {
    expect(slugify("C:\\\\double")).toBe("C---double");
  });
});

describe("ancestorDirsRootFirst", () => {
  it("returns directories from the filesystem root down to the start dir, root-first", () => {
    const start = path.resolve(path.sep, "a", "b", "c");
    const dirs = ancestorDirsRootFirst(start);

    // Last entry is the start dir itself.
    expect(dirs[dirs.length - 1]).toBe(start);
    // First entry is the filesystem root (dirname(root) === root).
    const root = dirs[0] as string;
    expect(path.dirname(root)).toBe(root);
    // Each subsequent entry nests under the previous one.
    for (let i = 1; i < dirs.length; i += 1) {
      expect(path.dirname(dirs[i] as string)).toBe(dirs[i - 1]);
    }
  });
});
