import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const DEFAULT_TIMEOUT_MS = 30_000;
const RETRY_MS = 25;

function pause(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function processStartToken(pid) {
  // Linux exposes a process start tick that lets us distinguish a dead PID from
  // a later process that reused the same number. Other platforms still safely
  // identify a dead PID when kill(pid, 0) returns ESRCH.
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const close = stat.lastIndexOf(")");
    return stat.slice(close + 2).trim().split(/\s+/)[19] ?? null;
  } catch {
    return null;
  }
}

function inspectHolder(lockPath) {
  try {
    const holderPath = fs.statSync(lockPath).isDirectory() ? path.join(lockPath, "holder.json") : lockPath;
    const value = JSON.parse(fs.readFileSync(holderPath, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? { kind: "holder", value }
      : { kind: "invalid" };
  } catch (error) {
    return error?.code === "ENOENT" ? { kind: "missing" } : { kind: "invalid" };
  }
}

function readHolder(lockPath) {
  const inspected = inspectHolder(lockPath);
  return inspected.kind === "holder" ? inspected.value : null;
}

function describeHolder(holder) {
  if (!holder) return "holder metadata is unavailable";
  return `pid ${holder.pid ?? "unknown"} on ${holder.hostname ?? "unknown host"} since ${holder.acquired_at ?? "unknown time"} (token ${holder.token ?? "unknown"})`;
}

function staleStatus(holder) {
  if (!holder || typeof holder.pid !== "number" || !Number.isInteger(holder.pid) || holder.pid <= 0 || typeof holder.hostname !== "string" || !holder.token) {
    return "unknown";
  }
  if (holder.hostname !== os.hostname()) return "unknown";
  try {
    process.kill(holder.pid, 0);
  } catch (error) {
    if (error && error.code === "ESRCH") return "stale";
    return "unknown";
  }
  if (holder.process_start_token) {
    const currentStart = processStartToken(holder.pid);
    if (currentStart && currentStart !== holder.process_start_token) return "stale";
  }
  return "live";
}

function publishHolder(lockPath) {
  const holder = {
    token: crypto.randomUUID(),
    pid: process.pid,
    hostname: os.hostname(),
    process_start_token: processStartToken(process.pid),
    acquired_at: new Date().toISOString()
  };
  const pending = `${lockPath}.pending-${holder.token}`;
  fs.writeFileSync(pending, `${JSON.stringify(holder)}\n`, { encoding: "utf8", flag: "wx" });
  try {
    // The complete holder record becomes visible in one atomic link operation.
    // Unlike mkdir + write, contenders can never observe an uninitialized lock.
    fs.linkSync(pending, lockPath);
    return holder;
  } finally {
    fs.rmSync(pending, { force: true });
  }
}

function removeDirectory(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
}

function acquireRecoveryGuard(locksPath, deadline) {
  const guardPath = path.join(locksPath, "write.recovery.lock");
  while (true) {
    try {
      fs.mkdirSync(guardPath);
      return () => removeDirectory(guardPath);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new Error("Workspace write lock recovery is already in progress; refusing to bypass it.");
      pause(RETRY_MS);
    }
  }
}

function reclaimStaleLock(locksPath, lockPath, expected, deadline) {
  const releaseGuard = acquireRecoveryGuard(locksPath, deadline);
  try {
    const current = readHolder(lockPath);
    if (!current || current.token !== expected.token) return false;
    if (staleStatus(current) !== "stale") return false;
    // New writers check the guard after creating their lock and release it
    // before doing work. Holding this guard therefore makes this removal safe.
    removeDirectory(lockPath);
    return true;
  } finally {
    releaseGuard();
  }
}

export function acquireWorkspaceWriteLock(root, options = {}) {
  const resolvedRoot = path.resolve(root);
  const timeout = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + Math.max(0, timeout);
  const locksPath = path.join(resolvedRoot, ".rsh", "locks");
  const lockPath = path.join(locksPath, "write.lock");
  const recoveryPath = path.join(locksPath, "write.recovery.lock");
  fs.mkdirSync(locksPath, { recursive: true });

  while (true) {
    if (fs.existsSync(recoveryPath)) {
      if (Date.now() >= deadline) throw new Error("Workspace write lock recovery is in progress; refusing to write concurrently.");
      pause(RETRY_MS);
      continue;
    }
    try {
      const holder = publishHolder(lockPath);
      // A recovery guard may have appeared between the first check and publish.
      // Do not enter the critical section until it has gone away.
      if (fs.existsSync(recoveryPath)) {
        removeDirectory(lockPath);
        if (Date.now() >= deadline) throw new Error("Workspace write lock recovery is in progress; refusing to write concurrently.");
        pause(RETRY_MS);
        continue;
      }
      return () => {
        const current = readHolder(lockPath);
        if (current?.token === holder.token) removeDirectory(lockPath);
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }

    // The prior holder can release after linkSync reports EEXIST. A missing
    // lock is a normal retry; malformed metadata remains a hard stop.
    const inspected = inspectHolder(lockPath);
    if (inspected.kind === "missing") continue;
    const holder = inspected.kind === "holder" ? inspected.value : null;
    const status = staleStatus(holder);
    if (status === "stale") {
      if (reclaimStaleLock(locksPath, lockPath, holder, deadline)) continue;
    } else if (status === "unknown") {
      throw new Error(`Workspace write lock cannot be safely recovered; ${describeHolder(holder)}. Resolve .rsh/locks/write.lock manually after confirming its owner is gone.`);
    }
    if (holder?.hostname === os.hostname() && holder?.pid === process.pid) {
      throw new Error("Workspace write lock is already held by this process; nested or concurrent same-process writers are not supported.");
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for the workspace write lock held by ${describeHolder(holder)}.`);
    }
    pause(RETRY_MS);
  }
}

export function withWorkspaceWriteLock(root, operation, options = {}) {
  if (typeof operation !== "function") throw new Error("Workspace write lock operation must be a function");
  const release = acquireWorkspaceWriteLock(root, options);
  let result;
  try {
    result = operation();
  } catch (error) {
    release();
    throw error;
  }
  if (result && typeof result.then === "function") return Promise.resolve(result).finally(release);
  release();
  return result;
}
