import test from "node:test";
import assert from "node:assert/strict";
import { createFrontierId,parseFrontier,serializeFrontier } from "../src/core/frontier.js";
import { Q1,Q2,D1 } from "./helpers.js";
const doc=(body,heading="## Open")=>`# R\n\n${heading}\n${body}`;
test("Open tree parses nesting and preserves bracketed ID prefix",()=>{const nodes=parseFrontier(doc(`- [${Q1}] parent\n  - [${D1}] child\n`));assert.deepEqual(nodes.map(x=>[x.id,x.parent,x.depth]),[[Q1,null,0],[D1,Q1,1]]);assert.equal(serializeFrontier(nodes),`- [${Q1}] parent\n  - [${D1}] child`);});
test("Open tree rejects duplicate IDs, indentation, depth jumps, and malformed prefixes",()=>{for(const text of [doc(`- [${Q1}] a\n- [${Q1}] b\n`),doc(`- [${Q1}] a\n - [${Q2}] b\n`),doc(`    - [${Q2}] b\n`),doc(`* [${Q1}] a\n`),doc(`- [Q-ABC] a\n`)])assert.throws(()=>parseFrontier(text));});
test("generated question and direction IDs have five lowercase base36 characters",()=>{assert.match(createFrontierId("question"),/^Q-[0-9a-z]{5}$/);assert.match(createFrontierId("direction"),/^D-[0-9a-z]{5}$/);});
test("Open tree continues to read legacy three-character IDs",()=>{const nodes=parseFrontier(doc("- [Q-abc] legacy\n  - [D-4z1] legacy direction\n"));assert.deepEqual(nodes.map(x=>x.id),["Q-abc","D-4z1"]);});
