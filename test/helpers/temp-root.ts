import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Discovery walks every ancestor directory looking for CLAUDE.md files, so
// synthetic test dirs must live outside the user's home. On Windows that is
// the drive root (the OS temp dir sits under the home dir). On POSIX the OS
// temp dir is already outside home; realpath it because macOS's /var/folders
// is a symlink to /private/var/folders and discovery reports resolved paths.
const TEMP_BASE = process.platform === "win32" ? path.parse(process.cwd()).root : realpathSync(tmpdir());

export function makeTempRoot(label: string): string {
  return path.join(TEMP_BASE, `cmddoctor-${label}-${process.pid}-${Date.now()}`);
}
