import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { tempWorkspace } from "./helpers.js";
import { commitFileBatch } from "../src/core/fs.js";
import { withWorkspaceWriteLock } from "../src/core/write-lock.js";
const mod=new URL("../src/core/write-lock.js",import.meta.url).href;
function worker(root,trace,name){const script=`import fs from "node:fs";import{withWorkspaceWriteLock}from ${JSON.stringify(mod)};withWorkspaceWriteLock(${JSON.stringify(root)},()=>{fs.appendFileSync(${JSON.stringify(trace)},"start ${name}\\n");Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,80);fs.appendFileSync(${JSON.stringify(trace)},"end ${name}\\n")},{timeoutMs:5000});`;return new Promise((resolve,reject)=>{const c=spawn(process.execPath,["--input-type=module","--eval",script]);c.on("error",reject);c.on("exit",code=>code===0?resolve():reject(new Error(`worker ${code}`)));});}
test("write lock serializes processes and releases on throw",async()=>{const root=tempWorkspace("lock"),trace=path.join(os.tmpdir(),`rsh-trace-${process.pid}-${Date.now()}`);await Promise.all([worker(root,trace,"a"),worker(root,trace,"b")]);const lines=fs.readFileSync(trace,"utf8").trim().split("\n");assert.equal(lines.length,4);assert.equal(lines[1],`end ${lines[0].slice(6)}`);assert.equal(lines[3],`end ${lines[2].slice(6)}`);assert.notEqual(lines[0],lines[2]);assert.throws(()=>withWorkspaceWriteLock(root,()=>{throw new Error("boom")}),/boom/);assert.equal(fs.existsSync(path.join(root,".rsh","locks","write.lock")),false);});
test("batch commit rolls back earlier replacement after later failure",()=>{const root=tempWorkspace("rollback"),first=path.join(root,"first.txt"),bad=path.join(root,"occupied");fs.writeFileSync(first,"before");fs.mkdirSync(bad);assert.throws(()=>commitFileBatch([{target:first,contents:"after"},{target:bad,contents:"bad"}]));assert.equal(fs.readFileSync(first,"utf8"),"before");assert.equal(fs.statSync(bad).isDirectory(),true);assert.equal(fs.readdirSync(root).some(n=>n.includes(".txn-")||n.includes(".backup-")),false);});
