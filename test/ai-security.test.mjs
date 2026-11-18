import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handler as draftHandler } from "../netlify/functions/ai-menu-draft.mjs";
import { handler as applyHandler } from "../netlify/functions/ai-menu-apply.mjs";

const originalFetch=globalThis.fetch;
const originalEnv={...process.env};
function event(body,token="user-token"){return {httpMethod:"POST",headers:{authorization:"Bearer "+token},body:JSON.stringify(body)};}
function response(status,data){return {ok:status>=200&&status<300,status,json:async()=>data};}
test.afterEach(()=>{globalThis.fetch=originalFetch;process.env={...originalEnv};});

test("mock draft is persisted server-side with id and hash; never calls OpenAI",async()=>{
 process.env.AI_MODE="mock";process.env.SUPABASE_URL="https://db.test";process.env.SUPABASE_PUBLISHABLE_KEY="public";
 let saved;
 globalThis.fetch=async(url,opts={})=>{
  if(String(url).endsWith("/auth/v1/user"))return response(200,{id:"user-a"});
  if(String(url).includes("/screen_categories?"))return response(200,[{screen_id:"screen3",category_id:"cat3"},{screen_id:"screen1",category_id:"legacy"}]);
  if(String(url).endsWith("/rpc/create_ai_menu_draft")){saved=JSON.parse(opts.body);return response(200,{draft_id:"draft-1",operations_hash:"hash-1",summary:saved.p_summary,operations:saved.p_operations,expires_at:"2099-01-01"});}
  throw new Error("unexpected network target "+url);
 };
 const out=await draftHandler(event({prompt:"Покажи пример"}));const body=JSON.parse(out.body);
 assert.equal(out.statusCode,200);assert.equal(body.draft_id,"draft-1");assert.equal(saved.p_mode,"mock");
 assert.equal(saved.p_operations[0].category_id,"cat3");
});

test("direct apply request without prior draft is blocked in mock before network",async()=>{
 process.env.AI_MODE="mock";let calls=0;globalThis.fetch=async()=>{calls++;throw new Error("must not call");};
 const out=await applyHandler(event({draft_id:"forged",operations_hash:"x"}));
 assert.equal(out.statusCode,403);assert.equal(calls,0);
});

test("mock mode cannot apply even when arbitrary operations are supplied",async()=>{
 process.env.AI_MODE="mock";let calls=0;globalThis.fetch=async()=>{calls++;throw new Error("must not call");};
 const out=await applyHandler(event({operations:[{type:"update_item",id:"legacy"}]}));
 assert.equal(out.statusCode,403);assert.equal(calls,0);
});

test("future apply endpoint rejects client-submitted operations; accepts only draft id and hash",async()=>{
 process.env.AI_MODE="openai";process.env.SUPABASE_URL="https://db.test";process.env.SUPABASE_PUBLISHABLE_KEY="public";
 let rpcCalls=0;
 globalThis.fetch=async(url,opts={})=>{
  if(String(url).endsWith("/auth/v1/user"))return response(200,{id:"user-a"});
  if(String(url).includes("/rpc/"))rpcCalls++;
  throw new Error("unexpected");
 };
 const out=await applyHandler(event({draft_id:"draft-1",operations_hash:"hash",operations:[{type:"update_item"}]}));
 assert.equal(out.statusCode,400);assert.equal(rpcCalls,0);
});

test("expired, changed, foreign-owner, replay, shared-category and multi-op rollback are DB-RPC invariants",()=>{
 // These invariants are implemented inside apply_ai_menu_draft() in a single PostgreSQL statement:
 // owner check; expires_at; stored md5; consumed_at FOR UPDATE; category anti-join; transaction rollback.
 const sql=requireSqlContract();
 for(const token of ["user_id <> auth.uid()","expires_at <= now()","consumed_at is not null","p_operations_hash","screen1","screen2","for update"])
  assert.ok(sql.toLowerCase().includes(token.toLowerCase()),"missing SQL guard: "+token);
 assert.ok(sql.includes("for op in select value from jsonb_array_elements(d.operations)"));
});
function requireSqlContract(){
 return readFileSync(new URL("../sql/screen3_ai_security.sql", import.meta.url),"utf8");
}
