import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handler as draftHandler } from "../netlify/functions/ai-menu-draft.mjs";
import { handler as applyHandler } from "../netlify/functions/ai-menu-apply.mjs";

const originalFetch=globalThis.fetch, originalEnv={...process.env};
const sql=readFileSync(new URL("../sql/screen3_ai_security.sql",import.meta.url),"utf8").toLowerCase();
function event(body,token="user-token"){return {httpMethod:"POST",headers:{authorization:"Bearer "+token},body:JSON.stringify(body)};}
function response(status,data){return {ok:status>=200&&status<300,status,json:async()=>data};}
test.afterEach(()=>{globalThis.fetch=originalFetch;process.env={...originalEnv};});

test("mock draft is server-persisted with id/hash and OpenAI is never called",async()=>{
 process.env.AI_MODE="mock";process.env.SUPABASE_URL="https://db.test";process.env.SUPABASE_PUBLISHABLE_KEY="public";process.env.SUPABASE_SERVICE_ROLE_KEY="server-only";
 let saved,serviceHeader;
 globalThis.fetch=async(url,opts={})=>{
  if(String(url).endsWith("/auth/v1/user"))return response(200,{id:"user-a"});
  if(String(url).includes("/screen_categories?"))return response(200,[{screen_id:"screen3",category_id:"cat3"},{screen_id:"screen1",category_id:"legacy"}]);
  if(String(url).endsWith("/rpc/create_ai_menu_draft")){saved=JSON.parse(opts.body);serviceHeader=opts.headers.Authorization;return response(200,{draft_id:"draft-1",operations_hash:"hash-1",summary:saved.p_summary,operations:saved.p_operations,expires_at:"2099-01-01"});}
  throw new Error("unexpected network target "+url);
 };
 const out=await draftHandler(event({prompt:"Покажи пример"})),body=JSON.parse(out.body);
 assert.equal(out.statusCode,200);assert.equal(body.draft_id,"draft-1");assert.equal(saved.p_mode,"mock");
 assert.equal(saved.p_user_id,"user-a");assert.equal(saved.p_operations[0].category_id,"cat3");
 assert.equal(serviceHeader,"Bearer server-only");
});

test("direct request without a previously stored draft is blocked in mock",async()=>{
 process.env.AI_MODE="mock";let calls=0;globalThis.fetch=async()=>{calls++;throw Error("must not call");};
 const out=await applyHandler(event({draft_id:"forged",operations_hash:"x"}));
 assert.equal(out.statusCode,403);assert.equal(calls,0);
});

test("changed operations supplied by client are rejected; hash is verified against stored JSON",async()=>{
 process.env.AI_MODE="openai";process.env.SUPABASE_URL="https://db.test";process.env.SUPABASE_PUBLISHABLE_KEY="public";
 let rpcCalls=0;globalThis.fetch=async(url)=>{if(String(url).endsWith("/auth/v1/user"))return response(200,{id:"u"});rpcCalls++;return response(200,{});};
 const out=await applyHandler(event({draft_id:"draft",operations_hash:"original",operations:[{type:"update_item",name:"tampered"}]}));
 assert.equal(out.statusCode,400);assert.equal(rpcCalls,0);
 assert.ok(sql.includes("md5(d.operations::text) <> d.operations_hash"));
});

test("a different user cannot confirm another user's draft",()=>{
 assert.ok(sql.includes("d.user_id <> auth.uid()"));
});

test("replay is rejected and concurrent confirms serialize on the draft row",()=>{
 assert.ok(sql.includes("d.consumed_at is not null"));
 assert.ok(sql.includes("for update"));
 assert.ok(sql.includes("set consumed_at=now()"));
});

test("expired drafts are rejected",()=>{
 assert.ok(sql.includes("d.expires_at <= now()"));
});

test("screen1 and screen2 categories are explicitly forbidden",()=>{
 assert.ok(sql.includes("sc.screen_id in ('screen1','screen2')"));
 assert.ok(sql.includes("category is not exclusive to screen3"));
});

test("migration detaches shared legacy category links and is idempotent",()=>{
 const migration=readFileSync(new URL("../sql/screen3_shashlychnaya.sql",import.meta.url),"utf8").toLowerCase();
 assert.ok(migration.includes("delete from public.screen_categories s3"));
 assert.ok(migration.includes("legacy.screen_id in ('screen1','screen2')"));
 assert.ok(migration.includes("pg_advisory_xact_lock"));
 assert.ok(migration.includes("where screen_id='screen3' and category_id=v_category_id"));
 assert.ok(migration.includes("public.categories.id%type"));
});
test("one bad operation aborts the single PostgreSQL RPC transaction",()=>{
 assert.ok(sql.includes("for op in select value from jsonb_array_elements(d.operations)"));
 assert.ok(sql.includes("security definer"));
 assert.ok(sql.includes("raise exception"));
 // There is one RPC apply call, not a loop of HTTP PATCH/POST writes.
 const apply=readFileSync(new URL("../netlify/functions/ai-menu-apply.mjs",import.meta.url),"utf8");
 assert.equal((apply.match(/rpc\/apply_ai_menu_draft/g)||[]).length,1);
 assert.ok(!apply.includes("/rest/v1/items"));
});

test("mock mode is read-only even for direct HTTP requests",async()=>{
 process.env.AI_MODE="mock";let calls=0;globalThis.fetch=async()=>{calls++;throw Error("must not call");};
 const out=await applyHandler(event({operations:[{type:"update_item",id:"legacy"}]}));
 assert.equal(out.statusCode,403);assert.equal(calls,0);
 assert.ok(sql.includes("p_mode not in ('mock','openai')")); // draft creation is server-role only
 assert.ok(sql.includes("if d.mode <> 'openai' then raise exception 'mock drafts are never writable'"));
});
