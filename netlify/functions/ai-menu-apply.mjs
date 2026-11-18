// Applies only explicitly confirmed screen-3 item operations. Uses the user's Supabase JWT (no service-role key).
const json=(statusCode,body)=>({statusCode,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},body:JSON.stringify(body)});
export async function handler(event){
  if(event.httpMethod!=="POST")return json(405,{error:"Method not allowed"});
  if((process.env.AI_MODE||"mock")!=="openai")return json(403,{error:"Запись отключена: активен бесплатный тестовый режим"});
  try{
    const token=event.headers.authorization?.replace(/^Bearer\s+/i,""),url=process.env.SUPABASE_URL,key=process.env.SUPABASE_PUBLISHABLE_KEY;
    if(!token||!url||!key)return json(401,{error:"Требуется авторизация"});
    const headers={apikey:key,Authorization:"Bearer "+token};
    const me=await fetch(url+"/auth/v1/user",{headers});
    if(!me.ok)return json(401,{error:"Сессия недействительна"});
    const user=await me.json(),allowedUsers=(process.env.AI_ALLOWED_USER_IDS||"").split(",").map(x=>x.trim()).filter(Boolean);
    if(!allowedUsers.includes(user.id))return json(403,{error:"Запись AI-изменений запрещена для этой учётной записи"});
    const body=JSON.parse(event.body||"{}"),ops=body.operations;
    if(!Array.isArray(ops)||!ops.length||ops.length>50)return json(400,{error:"Нет допустимых операций"});
    const get=async path=>{const r=await fetch(url+"/rest/v1/"+path,{headers});if(!r.ok)throw new Error("Не удалось проверить принадлежность категории экрану 3");return r.json()};
    const links=await get("screen_categories?select=screen_id,category_id");
    const s3=links.filter(x=>x.screen_id==="screen3").map(x=>String(x.category_id));
    const legacy=new Set(links.filter(x=>x.screen_id==="screen1"||x.screen_id==="screen2").map(x=>String(x.category_id)));
    const allowed=s3.filter(id=>!legacy.has(id));
    const items=await get("items?select=id,category_id");
    const fields=["name","price","weight_g","active"];
    for(const op of ops){
      if(!op||!["create_item","update_item"].includes(op.type)||!allowed.includes(String(op.category_id)))return json(403,{error:"Изменение заблокировано: доступ разрешён только отдельным категориям экрана 3"});
      const patch={};for(const f of fields)if(op[f]!==null&&op[f]!==undefined)patch[f]=op[f];
      if(patch.name!==undefined&&(typeof patch.name!=="string"||!patch.name.trim()||patch.name.length>120))return json(400,{error:"Некорректное название позиции"});
      if(patch.price!==undefined&&(typeof patch.price!=="number"||!Number.isFinite(patch.price)||patch.price<0||patch.price>1000000))return json(400,{error:"Некорректная цена"});
      if(patch.weight_g!==undefined&&(!Number.isInteger(patch.weight_g)||patch.weight_g<1||patch.weight_g>100000))return json(400,{error:"Некорректный вес"});
      if(patch.active!==undefined&&typeof patch.active!=="boolean")return json(400,{error:"Некорректный статус позиции"});
      if(op.type==="update_item"&&!items.some(i=>String(i.id)===String(op.id)&&String(i.category_id)===String(op.category_id)))return json(403,{error:"Позиция не принадлежит отдельному меню шашлычной"});
      if(op.type==="create_item"&&(!patch.name||typeof patch.name!=="string"))return json(400,{error:"У новой позиции должно быть название"});
      if(!Object.keys(patch).length&&op.type==="update_item")continue;
      const path=op.type==="create_item"?"items":"items?id=eq."+encodeURIComponent(op.id)+"&category_id=eq."+encodeURIComponent(op.category_id);
      const payload=op.type==="create_item"?{...patch,category_id:op.category_id,sort:items.filter(i=>String(i.category_id)===String(op.category_id)).length}:patch;
      const r=await fetch(url+"/rest/v1/"+path,{method:op.type==="create_item"?"POST":"PATCH",headers:{...headers,"Content-Type":"application/json",Prefer:"return=representation"},body:JSON.stringify(payload)});
      if(!r.ok)return json(502,{error:"Supabase отклонил запись. Проверьте права доступа и RLS."});
    }
    return json(200,{ok:true,applied:ops.length});
  }catch(e){return json(500,{error:e.message||"Ошибка сохранения"});}
}
