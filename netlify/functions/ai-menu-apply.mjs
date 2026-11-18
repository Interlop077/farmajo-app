// Applies only a previously persisted server draft via one PostgreSQL transaction.
const json=(statusCode,body)=>({statusCode,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},body:JSON.stringify(body)});
export async function handler(event){
  if(event.httpMethod!=="POST")return json(405,{error:"Method not allowed"});
  // Mock is permanently read-only here, before auth, DB access, or any write path.
  if((process.env.AI_MODE||"mock")!=="openai")return json(403,{error:"Запись запрещена: бесплатный mock-режим доступен только для предпросмотра"});
  try{
    const token=event.headers.authorization?.replace(/^Bearer\s+/i,""),url=process.env.SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY;
    if(!token||!url||!key)return json(401,{error:"Требуется авторизация"});
    const headers={apikey:key,Authorization:"Bearer "+token};
    const me=await fetch(url+"/auth/v1/user",{headers});
    if(!me.ok)return json(401,{error:"Сессия недействительна"});
    const user=await me.json();
    if(user?.app_metadata?.role!=="admin")return json(403,{error:"Доступ запрещён: требуется роль администратора FARMAJO"});
    const body=JSON.parse(event.body||"{}");
    if(!body.draft_id||!body.operations_hash||body.operations!==undefined)return json(400,{error:"Передайте только draft_id и operations_hash; операции клиентом не принимаются"});
    const r=await fetch(url+"/rest/v1/rpc/apply_ai_menu_draft",{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify({p_draft_id:body.draft_id,p_operations_hash:body.operations_hash})});
    const data=await r.json().catch(()=>null);
    if(!r.ok){const status=r.status===401?401:r.status===403?403:409;return json(status,{error:data?.message||"Черновик не подтверждён сервером"});}
    return json(200,data||{ok:true});
  }catch(e){return json(500,{error:e.message||"Ошибка применения черновика"});}
}
