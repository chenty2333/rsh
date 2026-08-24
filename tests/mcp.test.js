import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { cli,tempWorkspace } from "./helpers.js";
import { getRecord, listRecords } from "../src/core/record.js";
const init={jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"test",version:"1"}}};
function rpc(root,requests){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[cli,"mcp"],{cwd:root,stdio:["pipe","pipe","pipe"]});const out=[],expected=requests.filter(x=>x.id!==undefined).length;readline.createInterface({input:child.stdout}).on("line",line=>{out.push(JSON.parse(line));if(out.length===expected)child.stdin.end();});let err="";child.stderr.on("data",c=>{err+=c});child.on("error",reject);child.on("close",code=>code===0?resolve(out):reject(new Error(err||`MCP exited ${code}`)));requests.forEach(x=>child.stdin.write(`${JSON.stringify(x)}\n`));});}
test("MCP has exactly seven role-free tools, structured checkpoint input, and two Markdown resources",async()=>{const root=tempWorkspace("mcp-list");const r=await rpc(root,[init,{jsonrpc:"2.0",method:"notifications/initialized"},{jsonrpc:"2.0",id:2,method:"tools/list"},{jsonrpc:"2.0",id:3,method:"resources/list"},{jsonrpc:"2.0",id:4,method:"resources/templates/list"}]);const tools=r.find(x=>x.id===2).result.tools;assert.deepEqual(tools.map(x=>x.name).sort(),["rsh_checkpoint","rsh_doctor","rsh_find","rsh_get","rsh_mark","rsh_resume","rsh_status"]);assert.deepEqual(Object.keys(tools.find(x=>x.name==="rsh_find").inputSchema.properties).sort(),["kind","limit","query","regex","state"]);assert.deepEqual(tools.find(x=>x.name==="rsh_find").inputSchema.required,["query"]);assert.deepEqual(Object.keys(tools.find(x=>x.name==="rsh_get").inputSchema.properties),["id"]);const checkpointSchema=tools.find(x=>x.name==="rsh_checkpoint").inputSchema;assert.deepEqual(Object.keys(checkpointSchema.properties).sort(),["assertion","body","frontier","kind","relations","retry_if","scope","state"]);assert.deepEqual([...checkpointSchema.required].sort(),["body","kind"]);assert.match(checkpointSchema.properties.body.description,/Markdown body/);assert.match(checkpointSchema.properties.retry_if.items.description,/condition/);assert.doesNotMatch(checkpointSchema.properties.retry_if.items.description,/Markdown body/);assert.match(checkpointSchema.properties.frontier.description,/open, close, revise, or reopen/);assert.match(JSON.stringify(checkpointSchema.properties.frontier.items),/single-line question or direction text/);assert.match(JSON.stringify(checkpointSchema.properties.frontier.items),/provide at least text or parent/);assert.equal(Object.hasOwn(checkpointSchema.properties,"document"),false);assert.deepEqual(r.find(x=>x.id===3).result.resources.map(x=>[x.uri,x.mimeType]),[["rsh://state","text/markdown"]]);assert.deepEqual(r.find(x=>x.id===4).result.resourceTemplates.map(x=>[x.uriTemplate,x.mimeType]),[["rsh://record/{id}","text/markdown"]]);assert.equal(r.find(x=>x.id===1).result.capabilities.tools.listChanged,undefined);});
test("MCP structured checkpoint persists every Record field and automatic about",async()=>{
  const root=tempWorkspace("mcp-call");
  const body="# Conclusion 🧪\n\nMCP preserves $\\alpha_1$.\n\n# Argument\n\nDurable evidence.\n";
  const first=await rpc(root,[init,{jsonrpc:"2.0",method:"notifications/initialized"},{jsonrpc:"2.0",id:2,method:"resources/read",params:{uri:"rsh://state"}},{jsonrpc:"2.0",id:3,method:"tools/call",params:{name:"rsh_checkpoint",arguments:{kind:"result",body,state:"unchecked",frontier:[{action:"open",kind:"question",text:"Can the estimate be generalized?"}]}}}]);
  assert.equal(first.find(x=>x.id===2).result.contents[0].mimeType,"text/markdown");
  const written=first.find(x=>x.id===3).result;
  assert.match(written.content[0].text,/^# Checkpoint saved/);
  assert.ok(written.content.some(x=>x.type==="resource_link"&&/^rsh:\/\/record\/R-[0-9a-z]{3}$/.test(x.uri)));
  const id=written.structuredContent.id;
  const question=written.structuredContent.frontier_actions[0].id;
  const record=getRecord(root,id);
  assert.equal(record.body,body);
  assert.deepEqual(record.relations,[{type:"rsh:about",target:question}]);

  const complete={kind:"result",state:"checked",scope:"finite-dimensional",retry_if:["new evidence"],body:"# Relational conclusion\n\nComplete argument.\n",relations:[{type:"rsh:about",target:question},{type:"rsh:depends_on",target:id}],assertion:{subject:id,predicate:"math:motivates",object:question},frontier:[]};
  const second=await rpc(root,[init,{jsonrpc:"2.0",method:"notifications/initialized"},{jsonrpc:"2.0",id:4,method:"tools/call",params:{name:"rsh_checkpoint",arguments:complete}}]);
  const completeId=second.find(x=>x.id===4).result.structuredContent.id;
  assert.deepEqual(getRecord(root,completeId),{...complete,id:completeId,created_at:getRecord(root,completeId).created_at});
  assert.equal(JSON.stringify(written).includes("role"),false);
});

test("MCP structured checkpoint rejects document strings and malformed nested input",async()=>{const root=tempWorkspace("mcp-checkpoint-schema");const calls=[
  {document:"+++\nkind=\"result\"\n+++\nbody"},
  {kind:"result",body:"# Valid fields must not hide unknown ones",document:"legacy"},
  {kind:"result",body:"   "},
  {kind:"result",body:"# Body",relations:[{type:"rsh:about",target:"Q-abc",note:"legacy"}]},
  {kind:"result",body:"# Body",frontier:[{action:"open",kind:"Q",text:"bad"}]},
  {kind:"result",body:"# Body",relations:[{type:"rsh:depends_on",target:"R-abc"}]},
  {kind:"dead_end",body:"# Failed attempt"}
].map((arguments_,index)=>({jsonrpc:"2.0",id:index+2,method:"tools/call",params:{name:"rsh_checkpoint",arguments:arguments_}}));const r=await rpc(root,[init,{jsonrpc:"2.0",method:"notifications/initialized"},...calls]);for(const call of calls){const response=r.find(x=>x.id===call.id);assert.ok(response.error||response.result?.isError,`request ${call.id} should fail`);}assert.equal(listRecords(root).length,0);});

test("MCP schemas reject legacy and malformed IDs",async()=>{const root=tempWorkspace("mcp-ids");const calls=["Q-abcd","R-ffff","R-A1z","R-ab_"].map((id,index)=>({jsonrpc:"2.0",id:index+2,method:"tools/call",params:{name:"rsh_get",arguments:{id}}}));const r=await rpc(root,[init,{jsonrpc:"2.0",method:"notifications/initialized"},...calls]);for(const id of calls.map(x=>x.id)){const response=r.find(x=>x.id===id);assert.ok(response.error||response.result?.isError,`request ${id} should fail`);} });
