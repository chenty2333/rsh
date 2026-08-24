import fs from "node:fs";
import path from "node:path";

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function commitFileBatch(files) {
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const staged = [];
  try {
    for (const [index, item] of files.entries()) {
      ensureDir(path.dirname(item.target));
      const temporary = `${item.target}.txn-${token}-${index}`;
      fs.writeFileSync(temporary, item.contents, { encoding: "utf8", flag: "wx" });
      const backup = fs.existsSync(item.target) ? `${item.target}.backup-${token}-${index}` : null;
      const stagedItem = { ...item, temporary, backup, committed: false };
      staged.push(stagedItem);
      if (backup) fs.copyFileSync(item.target, backup, fs.constants.COPYFILE_EXCL);
    }
    for (const item of staged) {
      fs.renameSync(item.temporary, item.target);
      item.committed = true;
    }
  } catch (error) {
    for (const item of [...staged].reverse()) {
      if (item.committed) {
        if (item.backup) fs.copyFileSync(item.backup, item.target);
        else fs.rmSync(item.target, { force: true });
      }
      fs.rmSync(item.temporary, { force: true });
      if (item.backup) fs.rmSync(item.backup, { force: true });
    }
    throw error;
  }
  for (const item of staged) if (item.backup) fs.rmSync(item.backup, { force: true });
}
