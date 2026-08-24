import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { stringify } from "smol-toml";
import { initializeWorkspace } from "../src/core/workspace.js";
export const projectRoot=path.resolve(path.dirname(new URL(import.meta.url).pathname),"..");
export const cli=path.join(projectRoot,"bin","rsh.js");
export const emptyDir=(name="test")=>fs.mkdtempSync(path.join(os.tmpdir(),`rsh-${name}-`));
export function tempWorkspace(name="test"){const root=emptyDir(name);initializeWorkspace(root);return root;}
export function runCli(root,args,{input,env,success=true}={}){const r=spawnSync(process.execPath,[cli,...args],{cwd:root,encoding:"utf8",input,env:{...process.env,...env}});if(success&&r.status!==0)throw new Error(`rsh ${args.join(" ")} failed (${r.status})\n${r.stdout}\n${r.stderr}`);return r;}
export const inputDocument=(metadata,body="# Evidence\n\nDurable reasoning.\n")=>`+++\n${stringify(metadata).trimEnd()}\n+++\n${body}`;
export function treeSnapshot(root){const visit=(dir,prefix="")=>fs.existsSync(dir)?fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e=>{const rel=path.join(prefix,e.name);if(rel.startsWith(path.join(".rsh","locks")))return[];return e.isDirectory()?visit(path.join(dir,e.name),rel):[[rel,fs.readFileSync(path.join(dir,e.name),"utf8")]];}):[];return visit(root);}
export const Q1="Q-111",Q2="Q-222",D1="D-333";
export const relation=(type,target)=>({type,target});
export function setOpen(root,lines){const rendered=lines.map(line=>line.replace(/^([ ]*)- ([QD]-[0-9a-z]{3}) /,"$1- [$2] "));fs.writeFileSync(path.join(root,"RESEARCH.md"),`# Research\n\n## Context\n\n测试 $\\alpha$\n\n## Open\n${rendered.join("\n")}${rendered.length?"\n":""}`);}
