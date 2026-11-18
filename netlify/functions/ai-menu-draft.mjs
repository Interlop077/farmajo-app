// Netlify Function: AI may draft menu operations, but never writes to Supabase.
const json=(statusCode,body)=>({statusCode,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},body:JSON.stringify(body)});
async function authUser(event){
  const token=event.headers.authorization?.replace(/^Bearer\s+/i,"");
  const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_PUBLISHABLE_KEY;
  if(!token||!url||!key)throw new Error("Требуется авторизация Supabase и серверная конфигурация");
  const r=await fetch(url+"/auth/v1/user",{headers:{apikey:key,Authorization:"Bearer "+token}});
  if(!r.ok)throw new Error("Сессия недействительна");
  return {token,url,key,user:await r.json()};
}
async function dbGet(ctx,path){
  const r=await fetch(ctx.url+"/rest/v1/"+path,{headers:{apikey:ctx.key,Authorization:"Bearer "+ctx.token}});
  if(!r.ok)throw new Error("Не удалось прочитать меню шашлычной");
  return r.json();
}
const schema={type:"object",additionalProperties:false,properties:{
  summary:{type:"string"},
  operations:{type:"array",items:{type:"object",additionalProperties:false,properties:{
    type:{type:"string",enum:["create_item","update_item"]},
    id:{type:["string","null"]},category_id:{type:"string"},
    name:{type:["string","null"]},price:{type:["number","null"]},
    weight_g:{type:["integer","null"]},active:{type:["boolean","null"]}
  },required:["type","id","category_id","name","price","weight_g","active"]}}
},required:["summary","operations"]};
export async function handler(event){
  if(event.httpMethod!=="POST")return json(405,{error:"Method not allowed"});
  try{
    const ctx=await authUser(event),body=JSON.parse(event.body||"{}");
    const prompt=String(body.prompt||"").trim();
    if(!prompt||prompt.length>2000)return json(400,{error:"Запрос должен содержать от 1 до 2000 символов"});
    // Safe default: no API calls, no writes, no demo data inserted.
    if((process.env.AI_MODE||"mock")!=="openai")return json(200,{mode:"mock",summary:"Тестовый режим активен. Платные запросы не выполнялись. Предварительный просмотр проверен; реальных изменений пока нет.",operations:[]});
    const allowedUsers=(process.env.AI_ALLOWED_USER_IDS||"").split(",").map(x=>x.trim()).filter(Boolean);\n    if(!allowedUsers.includes(ctx.user.id))return json(403,{error:"AI-доступ не разрешён для этой учётной записи. Настройте AI_ALLOWED_USER_IDS в Netlify."});\n    const links=await dbGet(ctx,"screen_categories?select=screen_id,category_id");
    const screen3Ids=links.filter(x=>x.screen_id==="screen3").map(x=>String(x.category_id));
    const legacyIds=new Set(links.filter(x=>x.screen_id==="screen1"||x.screen_id==="screen2").map(x=>String(x.category_id)));
    const allowedIds=screen3Ids.filter(id=>!legacyIds.has(id));
    const allCats=await dbGet(ctx,"categories?select=id,name");
    const allItems=await dbGet(ctx,"items?select=id,category_id,name,price,weight_g,active");
    const categories=allCats.filter(c=>allowedIds.includes(String(c.id)));
    const items=allItems.filter(i=>allowedIds.includes(String(i.category_id)));
    if(!categories.length)return json(400,{error:"Для экрана 3 нет отдельных категорий. Сначала настройте категории шашлычной."});
    const key=process.env.OPENAI_API_KEY;
    if(!key)return json(503,{error:"AI_MODE=openai, но OPENAI_API_KEY не задан. Ключ должен храниться в Netlify Environment Variables."});
    const model=process.env.OPENAI_MODEL||"gpt-4.1-mini";
    const instructions="Ты помощник-редактор меню шашлычной FARMAJO. Составляй только черновик изменений позиций меню. Используй только переданные категории и позиции экрана screen3. Никогда не предлагай менять экраны, категории или позиции экранов 1 и 2. Разрешены только create_item и update_item. Не выдумывай цены или граммовку: если пользователь не указал их, оставь null. Не выполняй никаких записей.";
    const request={prompt,categories,items};
    const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+key},body:JSON.stringify({model,instructions,input:JSON.stringify(request),text:{format:{type:"json_schema",name:"farmajo_menu_draft",strict:true,schema}}})});
    const data=await response.json();
    if(!response.ok)return json(502,{error:data.error?.message||"Ошибка OpenAI API"});
    const output=data.output?.flatMap(x=>x.content||[]).find(x=>x.type==="output_text")?.text||data.output_text;
    if(!output)return json(502,{error:"OpenAI не вернул текст черновика"});
    const result=JSON.parse(output);
    const knownItems=new Set(items.map(i=>String(i.id)));
    for(const op of result.operations||[]){
      if(!allowedIds.includes(String(op.category_id)))return json(502,{error:"AI предложил категорию вне экрана 3"});
      if(op.type==="update_item"&&!knownItems.has(String(op.id)))return json(502,{error:"AI предложил позицию вне меню шашлычной"});
      if(op.type==="create_item"&&op.id!==null)return json(502,{error:"Некорректный черновик новой позиции"});
    }
    return json(200,{mode:"openai",summary:result.summary,operations:result.operations});
  }catch(e){return json(500,{error:e.message||"Ошибка подготовки черновика"});}
}
