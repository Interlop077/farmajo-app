// Server-owned AI draft. OpenAI is intentionally disabled; mock drafts are preview-only.
const json=(statusCode,body)=>({statusCode,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},body:JSON.stringify(body)});
async function context(event){
  const token=event.headers.authorization?.replace(/^Bearer\s+/i,"");
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY,serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!token||!url||!key)throw new Error("Требуется авторизация Supabase и серверная конфигурация");
  const headers={apikey:key,Authorization:"Bearer "+token};
  const r=await fetch(url+"/auth/v1/user",{headers});
  if(!r.ok)throw new Error("Сессия недействительна");
  const user=await r.json();
  if(user?.app_metadata?.role!=="admin")throw new Error("Доступ запрещён: требуется роль администратора FARMAJO");
  return {url,headers,user,serviceKey};
}
async function db(ctx,path){if(!ctx.serviceKey)throw new Error("На сервере не задан SUPABASE_SERVICE_ROLE_KEY");const headers={apikey:ctx.serviceKey,Authorization:"Bearer "+ctx.serviceKey};const r=await fetch(ctx.url+"/rest/v1/"+path,{headers});if(!r.ok)throw new Error("Не удалось прочитать меню шашлычной");return r.json();}
async function rpc(ctx,name,body){if(!ctx.serviceKey)throw new Error("На сервере не задан SUPABASE_SERVICE_ROLE_KEY; черновик не создан");const r=await fetch(ctx.url+"/rest/v1/rpc/"+name,{method:"POST",headers:{apikey:ctx.serviceKey,Authorization:"Bearer "+ctx.serviceKey,"Content-Type":"application/json"},body:JSON.stringify(body)});const data=await r.json().catch(()=>null);if(!r.ok)throw new Error(data?.message||"Не удалось сохранить серверный черновик");return data;}
export async function handler(event){
  if(event.httpMethod!=="POST")return json(405,{error:"Method not allowed"});
  try{
    const ctx=await context(event),body=JSON.parse(event.body||"{}"),prompt=String(body.prompt||"").trim();
    if(!prompt||prompt.length>2000)return json(400,{error:"Запрос должен содержать от 1 до 2000 символов"});
    // Hard fail closed: no OpenAI calls or API key reads in this branch.
    if((process.env.AI_MODE||"mock")!=="mock")return json(503,{error:"OpenAI отключён в этой версии. Используйте бесплатный mock-режим."});
    const links=await db(ctx,"screen_categories?select=screen_id,category_id");
    const s3=links.filter(x=>x.screen_id==="screen3").map(x=>String(x.category_id));
    const legacy=new Set(links.filter(x=>x.screen_id==="screen1"||x.screen_id==="screen2").map(x=>String(x.category_id)));
    const category=s3.find(id=>!legacy.has(id));
    const operations=category?[{type:"create_item",id:null,category_id:category,name:"Демо-позиция (не сохраняется)",price:null,weight_g:null,active:true}]:[];
    const summary="Бесплатный mock-предпросмотр. Это демонстрация, не результат OpenAI. Запись в Supabase запрещена.";
    const saved=await rpc(ctx,"create_ai_menu_draft",{p_summary:summary,p_operations:operations,p_mode:"mock",p_ttl_seconds:900,p_user_id:ctx.user.id});
    return json(200,{mode:"mock",draft_id:saved.draft_id,operations_hash:saved.operations_hash,
      summary:saved.summary,operations:saved.operations,expires_at:saved.expires_at});
  }catch(e){return json(500,{error:e.message||"Ошибка подготовки черновика"});}
}
