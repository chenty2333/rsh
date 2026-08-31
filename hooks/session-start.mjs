#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const FORMAT = 'format = "rsh/0.1.5"\n';

function input() {
  try {
    const value = JSON.parse(fs.readFileSync(0, "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

function workspace(start) {
  let current = path.resolve(start);
  try {
    if (fs.statSync(current).isFile()) current = path.dirname(current);
  } catch {
    return null;
  }
  while (true) {
    const manifest = path.join(current, ".rsh", "manifest.toml");
    if (fs.existsSync(manifest)) {
      try {
        return fs.readFileSync(manifest, "utf8") === FORMAT ? current : null;
      } catch {
        return null;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

const event = input();
const root = workspace(typeof event.cwd === "string" && event.cwd ? event.cwd : process.cwd());
if (root) {
  const packagedCli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "rsh.js");
  const command = fs.existsSync(packagedCli) ? process.execPath : "rsh";
  const arguments_ = fs.existsSync(packagedCli) ? [packagedCli, "brief"] : ["brief"];
  const result = spawnSync(command, arguments_, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 4500
  });
  if (result.status === 0 && result.stdout) process.stdout.write(result.stdout);
}
