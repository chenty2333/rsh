import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { inputDocument, runCli, tempWorkspace } from "./helpers.js";
import { checkpoint, getRecord } from "../src/core/record.js";

const metadata = { kind: "result", state: "unchecked", relations: [], frontier: [] };

test("CLI help and arity expose replace",()=>{
  const root=tempWorkspace("replace-cli-help");
  assert.match(runCli(root,["help"]).stdout,/rsh replace RECORD_ID FILE\.md/);
  assert.match(runCli(root,["replace"],{success:false}).stderr,/exactly 2 positional arguments/);
  assert.match(runCli(root,["replace","R-abcd","-"],{success:false}).stderr,/exactly 3 lowercase base36/);
});

test("CLI replace accepts a file or stdin and withdraws each predecessor",()=>{
  const root=tempWorkspace("replace-cli");
  const first=checkpoint(root,inputDocument(metadata,"# First\n\nBroken formula.\n"),{isText:true});
  const file=path.join(root,"replacement.md");
  fs.writeFileSync(file,inputDocument({...metadata,state:"checked"},"# Fixed\n\n$\\mathbb{F}_q$.\n"));
  const fileResult=runCli(root,["replace",first.id,file]).stdout;
  const secondId=fileResult.match(/R-[0-9a-z]{3}/)?.[0];
  assert.ok(secondId);
  assert.equal(getRecord(root,first.id).state,"withdrawn");
  assert.deepEqual(getRecord(root,secondId).relations,[{type:"rsh:supersedes",target:first.id}]);

  const stdinResult=runCli(root,["replace",secondId,"-"],{input:inputDocument(metadata,"# Fixed again\n\nUnicode: ℱ_q.\n")}).stdout;
  const thirdId=stdinResult.match(/R-[0-9a-z]{3}/)?.[0];
  assert.ok(thirdId);
  assert.equal(getRecord(root,secondId).state,"withdrawn");
  assert.match(getRecord(root,thirdId).body,/Fixed again/);
});
